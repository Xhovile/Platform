import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { paymentWebhookHandler } from '../payment.webhooks.js';
import { paymentRepository } from '../payment.repository.js';
import { serverOrderService } from '../../orders/order.service.js';
import { orderRepository } from '../../orders/order.repository.js';
import { getPaymentDb } from '../../../postgresCompat.js';
import '../../payouts/payout.schema.js';

const WEBHOOK_SECRET = 'idempotency-test-secret';

function signWebhook(rawPayload: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawPayload).digest('hex');
}

function clearPaymentState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payout_events').run();
  db.prepare('DELETE FROM payout_attempts').run();
  db.prepare('DELETE FROM payouts').run();
  db.prepare('DELETE FROM escrows').run();
  db.prepare('DELETE FROM seller_payout_account_events').run();
  db.prepare('DELETE FROM seller_payout_accounts WHERE seller_uid = ?').run('seller_1');
  db.prepare('DELETE FROM payment_webhook_events').run();
  orderRepository.clear();
  paymentRepository.clear();
}

function seedOrder(orderId: string, reference: string): void {
  const now = new Date().toISOString();
  serverOrderService.create({
    id: orderId,
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
    source: 'listing',
    status: 'pending_payment',
    currency: 'MWK',
    subtotal: { amount: 1000, currency: 'MWK' },
    total: { amount: 1000, currency: 'MWK' },
    items: [{
      listingId: 'listing_1',
      title: 'Item',
      quantity: 1,
      unitPrice: { amount: 1000, currency: 'MWK' },
    }],
    createdAt: now,
    updatedAt: now,
    paymentProvider: 'paychangu',
    paymentReference: reference,
    settlementRoute: 'escrow',
  });
}

function seedPayment(orderId: string, reference: string): void {
  const now = new Date().toISOString();
  paymentRepository.save({
    id: `pay_${reference}`,
    orderId,
    provider: 'paychangu',
    method: 'mobile_money',
    status: 'pending',
    amount: { amount: 1000, currency: 'MWK' },
    reference,
    providerReference: null,
    checkoutUrl: null,
    paidAt: null,
    rawResponse: {},
    verified: false,
    createdAt: now,
    updatedAt: now,
  });
}

test('payment webhook idempotency retries a non-terminal event after the referenced payment appears', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const rawWebhook = JSON.stringify({
    event_type: 'checkout.payment',
    event_id: 'evt-retry-1',
    tx_ref: 'txref-retry-1',
    status: 'successful',
    amount: 1000,
    currency: 'MWK',
  });

  try {
    const first = await paymentWebhookHandler.handlePaychanguWebhook({
      signature: signWebhook(rawWebhook),
      payload: rawWebhook,
    });

    assert.deepEqual(first, {
      ok: true,
      status: 'ignored',
      reference: 'txref-retry-1',
    });

    seedOrder('order_retry_1', 'txref-retry-1');
    seedPayment('order_retry_1', 'txref-retry-1');

    const second = await paymentWebhookHandler.handlePaychanguWebhook({
      signature: signWebhook(rawWebhook),
      payload: rawWebhook,
    });

    assert.deepEqual(second, {
      ok: true,
      status: 'processed',
      reference: 'txref-retry-1',
    });
    assert.equal(paymentRepository.findByReference('txref-retry-1')?.verified, true);
    assert.equal(orderRepository.findById('order_retry_1')?.status, 'in_escrow');

    const escrowCount = getPaymentDb()
      .prepare('SELECT COUNT(*) AS count FROM escrows WHERE order_id = ?')
      .get('order_retry_1') as { count: number };
    assert.equal(escrowCount.count, 1);

    const third = await paymentWebhookHandler.handlePaychanguWebhook({
      signature: signWebhook(rawWebhook),
      payload: rawWebhook,
    });

    assert.deepEqual(third, {
      ok: true,
      status: 'duplicate',
      reference: 'txref-retry-1',
    });
    assert.equal(
      (getPaymentDb().prepare('SELECT COUNT(*) AS count FROM escrows WHERE order_id = ?').get('order_retry_1') as { count: number }).count,
      1,
      'a terminal duplicate must not create another escrow',
    );
  } finally {
    clearPaymentState();
  }
});
