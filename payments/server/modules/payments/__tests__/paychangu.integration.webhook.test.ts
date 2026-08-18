import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPaymentState,
  createApp,
  fetchConnectPayoutsForOrder,
  fetchWebhookAuditRows,
  fetchWebhookAuditRowsByPayloadHash,
  hashPayload,
  initializePayment,
  mockFetch,
  mockPayChanguFetch,
  postPayChanguPayoutWebhook,
  postPayChanguWebhook,
  seedOrder,
  seedStoredPayment,
  seedVerifiedSellerPayoutDestination,
  signWebhook,
  countEscrowsForOrder,
  countPayoutEvents,
} from './paychangu.test.helpers.js';
import { escrowRepository, orderRepository, paymentRepository } from './paychangu.test.helpers.js';

test('integration: order -> paychangu payment -> verified webhook persists state', async () => {
  clearPaymentState();
  const app = createApp();
  const originalFetch = global.fetch;
  global.fetch = mockFetch(originalFetch);
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_it_1', 'txref-integration-1');
    const createPaymentRes = await initializePayment(base, 'order_it_1');
    assert.equal(createPaymentRes.status, 201);
    const rawWebhook = JSON.stringify({ event_type: 'charge.success', tx_ref: 'txref-integration-1', data: { tx_ref: 'txref-integration-1', status: 'successful', amount: 1000, currency: 'MWK' } });
    const webhookRes = await postPayChanguWebhook(base, rawWebhook);
    assert.equal(webhookRes.status, 200);
    assert.equal(orderRepository.findById('order_it_1')?.status, 'in_escrow');
    assert.equal(paymentRepository.findByReference('txref-integration-1')?.verified, true);
    assert.equal(paymentRepository.findByReference('txref-integration-1')?.status, 'captured');
    assert.equal(countEscrowsForOrder('order_it_1'), 1);
  } finally {
    global.fetch = originalFetch;
    server.close();
    clearPaymentState();
  }
});

test('integration: PayChangu callback for Connect order queues payout without escrow', async () => {
  clearPaymentState();
  const app = createApp();
  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-connect-1', 'successful', 1000);
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_connect_1', 'txref-connect-1', 'pending_payment', 'connect');
    seedStoredPayment('order_connect_1', 'txref-connect-1');
    seedVerifiedSellerPayoutDestination();
    const rawWebhook = JSON.stringify({ event_type: 'charge.success', event_id: 'evt_connect_success_1', tx_ref: 'txref-connect-1', data: { tx_ref: 'txref-connect-1', status: 'successful', amount: 1000, currency: 'MWK' } });
    assert.equal((await postPayChanguWebhook(base, rawWebhook)).status, 200);
    const savedOrder = orderRepository.findById('order_connect_1');
    const savedPayment = paymentRepository.findByReference('txref-connect-1');
    const payouts = fetchConnectPayoutsForOrder('order_connect_1');
    assert.equal(savedPayment?.verified, true);
    assert.equal(savedPayment?.status, 'captured');
    assert.equal(savedOrder?.status, 'paid');
    assert.equal(savedOrder?.escrowId ?? null, null);
    assert.equal(countEscrowsForOrder('order_connect_1'), 0);
    assert.equal(payouts.length, 1);
    const payout = payouts[0];
    assert.equal(payout.escrow_id, null);
    assert.equal(payout.destination_account_id, 'dest_seller_1_connect');
    assert.equal(payout.gross_amount, 1000);
    assert.equal(payout.platform_fee_amount, 30);
    assert.equal(payout.net_amount, 970);
    assert.equal(payout.seller_receives_amount, 970);
    assert.equal(payout.amount, 970);
    assert.equal(payout.status, 'queued');
    const formula = JSON.parse(payout.formula_snapshot ?? '{}') as Record<string, unknown>;
    assert.equal(formula.grossAmount, 1000);
    assert.equal(formula.platformFeeAmount, 30);
    assert.equal(formula.netAmount, 970);
    assert.equal(countPayoutEvents(payout.id, 'connect_payout_queued'), 1);
  } finally {
    global.fetch = originalFetch;
    server.close();
    clearPaymentState();
  }
});

test('integration: duplicate PayChangu callback for Connect order does not duplicate payout or seller notification', async () => {
  clearPaymentState();
  const app = createApp();
  const originalFetch = global.fetch;
  const originalConsoleLog = console.log;
  const notifications: unknown[][] = [];
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-connect-duplicate-1', 'successful', 1000);
  console.log = (...args: unknown[]) => { if (args[0] === '[notification] seller_payout_queued') notifications.push(args); originalConsoleLog(...args); };
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_connect_duplicate_1', 'txref-connect-duplicate-1', 'pending_payment', 'connect');
    seedStoredPayment('order_connect_duplicate_1', 'txref-connect-duplicate-1');
    seedVerifiedSellerPayoutDestination('dest_seller_1_connect_duplicate');
    const rawWebhook = JSON.stringify({ event_type: 'charge.success', event_id: 'evt_connect_duplicate_1', tx_ref: 'txref-connect-duplicate-1', data: { tx_ref: 'txref-connect-duplicate-1', status: 'successful', amount: 1000, currency: 'MWK' } });
    assert.equal((await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook))).status, 200);
    assert.equal((await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook))).status, 200);
    const payouts = fetchConnectPayoutsForOrder('order_connect_duplicate_1');
    assert.equal(payouts.length, 1);
    assert.equal(countPayoutEvents(payouts[0].id, 'connect_payout_queued'), 1);
    assert.equal(notifications.length, 1);
  } finally {
    global.fetch = originalFetch;
    console.log = originalConsoleLog;
    server.close();
    clearPaymentState();
  }
});

test('integration: PayChangu payout webhook route invokes payout handler', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const rawWebhook = JSON.stringify({ event_type: 'charge.success', event_id: 'evt_payout_route_1', data: { transaction: { status: 'successful', charge_id: 'BM-PO-payout-route-1-A01', payout_reference: 'payout-route-1', reference: 'provider-ref-route', transaction_id: 'provider-txn-route' } } });
  try {
    assert.equal((await postPayChanguPayoutWebhook(base, rawWebhook)).status, 200);
    const rows = fetchWebhookAuditRows('BM-PO-payout-route-1-A01');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'paychangu_payout');
    assert.equal(rows[0].provider_event_id, 'evt_payout_route_1');
    assert.equal(rows[0].tx_ref, 'BM-PO-payout-route-1-A01');
    assert.equal(rows[0].payload_hash, hashPayload(rawWebhook));
    assert.equal(rows[0].processing_status, 'ignored');
    assert.match(rows[0].error ?? '', /No matching payout found/);
  } finally {
    server.close();
    clearPaymentState();
  }
});

test('integration: invalid paychangu webhook signature is audited as rejected', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const rawWebhook = JSON.stringify({ event_type: 'api.charge.payment', event_id: 'evt_bad_sig_1', tx_ref: 'txref-invalid-signature-1', data: { tx_ref: 'txref-invalid-signature-1', status: 'paid', amount: 1000, currency: 'MWK' } });
    const res = await postPayChanguWebhook(base, rawWebhook, 'not-a-valid-signature');
    assert.equal(res.status, 400);
    const rows = fetchWebhookAuditRows('txref-invalid-signature-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].processing_status, 'rejected');
    assert.match(rows[0].error ?? '', /Invalid PayChangu webhook signature/);
  } finally {
    server.close();
    clearPaymentState();
  }
});

test('integration: malformed paychangu webhook JSON is audited as failed', async () => {
  clearPaymentState();
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const rawWebhook = '{"event_type":"api.charge.payment","tx_ref":"txref-malformed-1",';
    const res = await postPayChanguWebhook(base, rawWebhook);
    assert.equal(res.status, 400);
    const rows = fetchWebhookAuditRowsByPayloadHash(hashPayload(rawWebhook));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider_event_id, null);
    assert.equal(rows[0].tx_ref, null);
    assert.equal(rows[0].payload_hash, hashPayload(rawWebhook));
    assert.equal(rows[0].processing_status, 'failed');
    assert.ok(rows[0].processed_at);
    assert.equal(rows[0].error, 'Malformed webhook payload: invalid JSON');
  } finally {
    server.close();
    clearPaymentState();
  }
});

test('integration: pending webhook keeps payment and order pending without escrow', async () => {
  clearPaymentState();
  const app = createApp();
  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-pending-1', 'queued');
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_pending_1', 'txref-pending-1');
    seedStoredPayment('order_pending_1', 'txref-pending-1');
    const rawWebhook = JSON.stringify({ event_type: 'api.charge.payment', tx_ref: 'txref-pending-1', data: { tx_ref: 'txref-pending-1', status: 'queued', amount: 1000, currency: 'MWK' } });
    assert.equal((await postPayChanguWebhook(base, rawWebhook)).status, 200);
    assert.equal(paymentRepository.findByReference('txref-pending-1')?.status, 'pending');
    assert.equal(orderRepository.findById('order_pending_1')?.status, 'pending_payment');
    assert.equal(countEscrowsForOrder('order_pending_1'), 0);
  } finally {
    global.fetch = originalFetch;
    server.close();
    clearPaymentState();
  }
});

test('integration: failed webhook fails payment without paying order or creating escrow', async () => {
  clearPaymentState();
  const app = createApp();
  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-failed-1', 'failed');
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_failed_1', 'txref-failed-1');
    seedStoredPayment('order_failed_1', 'txref-failed-1');
    const rawWebhook = JSON.stringify({ event_type: 'api.charge.payment', tx_ref: 'txref-failed-1', data: { tx_ref: 'txref-failed-1', status: 'failed', amount: 1000, currency: 'MWK' } });
    assert.equal((await postPayChanguWebhook(base, rawWebhook)).status, 200);
    assert.equal(paymentRepository.findByReference('txref-failed-1')?.status, 'failed');
    assert.equal(orderRepository.findById('order_failed_1')?.status, 'pending_payment');
    assert.equal(countEscrowsForOrder('order_failed_1'), 0);
  } finally {
    global.fetch = originalFetch;
    server.close();
    clearPaymentState();
  }
});

test('integration: reversed webhook refunds captured escrow according to domain policy', async () => {
  clearPaymentState();
  const app = createApp();
  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-reversed-1', 'reversed');
  process.env.PAYCHANGU_WEBHOOK_SECRET = 'integration-secret';
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    seedOrder('order_reversed_1', 'txref-reversed-1', 'in_escrow');
    seedStoredPayment('order_reversed_1', 'txref-reversed-1');
    escrowRepository.create('order_reversed_1', 'MWK', 1000);
    const rawWebhook = JSON.stringify({ event_type: 'api.charge.payment', tx_ref: 'txref-reversed-1', data: { tx_ref: 'txref-reversed-1', status: 'reversed', amount: 1000, currency: 'MWK' } });
    assert.equal((await postPayChanguWebhook(base, rawWebhook)).status, 200);
    assert.equal(paymentRepository.findByReference('txref-reversed-1')?.status, 'refunded');
    assert.equal(orderRepository.findById('order_reversed_1')?.status, 'refunded');
    assert.equal(escrowRepository.findByOrderId('order_reversed_1')?.state, 'refunded');
    assert.equal(countEscrowsForOrder('order_reversed_1'), 1);
  } finally {
    global.fetch = originalFetch;
    server.close();
    clearPaymentState();
  }
});
