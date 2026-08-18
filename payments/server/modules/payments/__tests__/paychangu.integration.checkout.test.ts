import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPaymentState,
  createApp,
  fetchWebhookAuditRows,
  hashPayload,
  initializePayment,
  postPayChanguWebhook,
  mockPayChanguFetch,
  refs,
  seedOrder,
  signWebhook,
  countEscrowsForOrder,
} from './paychangu.test.helpers.js';
import { orderRepository, paymentRepository } from './paychangu.test.helpers.js';

test('integration: atomic checkout → paychangu payment → webhook persists state and classifies duplicate delivery', async () => {
  clearPaymentState();
  const db = refs.getPaymentDb();
  db.prepare('DELETE FROM sellers WHERE uid = ?').run('seller_1');
  db.prepare('DELETE FROM listings WHERE id = 999').run();
  db.prepare(`INSERT INTO sellers (uid, email) VALUES ('seller_1', 'seller@example.com')`).run();
  db.prepare(`INSERT INTO listings (
    id, seller_uid, name, price, category, university, whatsapp_number,
    status, condition, views_count, whatsapp_clicks, is_hidden, quantity, sold_quantity
  ) VALUES (999, 'seller_1', 'Test Item', 1000, 'test', 'Test University', '+265999111000',
    'available', 'used', 0, 0, 0, 5, 0)`).run();
  const app = createApp();
  const originalFetch = global.fetch;
  const originalConsoleLog = console.log;
  const notificationLogs: unknown[][] = [];
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-integration-1', 'successful', 1000);
  console.log = (...args: unknown[]) => { if (args[0] === '[notification] order_paid') notificationLogs.push(args); originalConsoleLog(...args); };
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const checkoutRes = await fetch(`${base}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({ listingId: 999, quantity: 1, method: 'mobile_money', returnUrl: 'https://example.com/return', cancelUrl: 'https://example.com/cancel', buyerName: 'Buyer One' }),
    });
    assert.equal(checkoutRes.status, 201);
    const checkoutResult = await checkoutRes.json() as { orderId?: string; reference?: string; checkoutUrl?: string; items?: Array<{ reference?: string }> };
    assert.ok(checkoutResult.orderId);
    assert.ok(checkoutResult.reference);
    assert.ok(checkoutResult.checkoutUrl);
    assert.equal(checkoutResult.items?.[0]?.reference, `${checkoutResult.orderId}-ITEM-01`);
    const verifyRes = await fetch(`${base}/api/payments/paychangu/verify/${encodeURIComponent('txref-integration-1')}`, { headers: { authorization: 'Bearer test' } });
    assert.equal(verifyRes.status, 200);
    const verifyResult = await verifyRes.json() as { verified?: boolean };
    assert.equal(verifyResult.verified, true);
    const rawWebhook = JSON.stringify({ event_type: 'api.charge.payment', event_id: 'evt_success_1', tx_ref: checkoutResult.reference, data: { tx_ref: checkoutResult.reference, status: 'paid', amount: 1000, currency: 'MWK' } });
    assert.equal((await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook))).status, 200);
    assert.equal((await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook))).status, 200);
    const savedOrder = orderRepository.findById(checkoutResult.orderId!);
    const savedPayment = paymentRepository.findByReference(checkoutResult.reference!);
    const auditRows = fetchWebhookAuditRows(checkoutResult.reference!);
    const processed = auditRows.filter((row) => row.processing_status === 'processed');
    const duplicates = auditRows.filter((row) => row.processing_status === 'duplicate');
    assert.equal(savedOrder?.status, 'in_escrow');
    assert.equal(savedOrder?.items[0]?.reference, `${checkoutResult.orderId}-ITEM-01`);
    assert.equal(savedPayment?.verified, true);
    assert.equal(savedPayment?.status, 'captured');
    assert.equal(countEscrowsForOrder(checkoutResult.orderId!), 1);
    assert.equal(processed.length, 1);
    assert.equal(duplicates.length, 1);
    assert.equal(notificationLogs.length, 1);
    assert.equal(processed[0].provider, 'paychangu');
    assert.equal(processed[0].provider_event_id, 'evt_success_1');
    assert.equal(processed[0].tx_ref, checkoutResult.reference);
    assert.equal(processed[0].payload_hash, hashPayload(rawWebhook));
    assert.equal(processed[0].processing_status, 'processed');
    assert.ok(processed[0].processed_at);
    assert.equal(processed[0].error, null);
    assert.equal(duplicates[0].processing_status, 'duplicate');
    assert.ok(duplicates[0].processed_at);
    assert.match(duplicates[0].error ?? '', /^Duplicate PayChangu webhook event/);
  } finally {
    global.fetch = originalFetch;
    console.log = originalConsoleLog;
    server.close();
    clearPaymentState();
    db.prepare('DELETE FROM listings WHERE id = 999').run();
    db.prepare('DELETE FROM sellers WHERE uid = ?').run('seller_1');
  }
});

test('integration: PayChangu-prefixed references activate escrow after verification', async () => {
  clearPaymentState();
  const prefixedReference = 'PAYCHANGU-ord_prefixed_1-1778797822347';
  const app = createApp();
  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, prefixedReference, 'successful');
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_prefixed_1', prefixedReference);
    const createPaymentRes = await initializePayment(base, 'order_prefixed_1');
    assert.equal(createPaymentRes.status, 201);
    const paymentResult = await createPaymentRes.json() as { reference?: string };
    assert.equal(paymentResult.reference, prefixedReference);
    const verifyRes = await fetch(`${base}/api/payments/paychangu/verify/${encodeURIComponent(prefixedReference)}`, { headers: { authorization: 'Bearer test' } });
    assert.equal(verifyRes.status, 200);
    const verifyResult = await verifyRes.json() as { verified?: boolean };
    assert.equal(verifyResult.verified, true);
    assert.equal(orderRepository.findById('order_prefixed_1')?.status, 'in_escrow');
    assert.equal(paymentRepository.findByReference(prefixedReference)?.verified, true);
    assert.equal(paymentRepository.findByReference(prefixedReference)?.status, 'captured');
    assert.equal(countEscrowsForOrder('order_prefixed_1'), 1);
  } finally {
    global.fetch = originalFetch;
    server.close();
    clearPaymentState();
  }
});
