import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerPaymentService } from '../payment.service.js';
import {
  clearPaymentState,
  createApp,
  initializePayment,
  mockPayChanguFetch,
  postPayChanguWebhook,
  seedOrder,
  seedStoredPayment,
  signWebhook,
  countEscrowsForOrder,
} from './paychangu.test.helpers.js';
import { escrowRepository, orderRepository, paymentRepository } from './paychangu.test.helpers.js';

const WEBHOOK_SECRET = 'integration-secret';

async function withServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    return await run(base);
  } finally {
    server.close();
    clearPaymentState();
  }
}

test('financial integrity: successful webhook with overpayment is ignored without settlement', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';

  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-webhook-overpaid-1', 'successful', 1250);

  try {
    seedOrder('order_webhook_overpaid_1', 'txref-webhook-overpaid-1');
    seedStoredPayment('order_webhook_overpaid_1', 'txref-webhook-overpaid-1');

    await withServer(async (base) => {
      const rawWebhook = JSON.stringify({
        event_type: 'charge.success',
        event_id: 'evt_webhook_overpaid_1',
        tx_ref: 'txref-webhook-overpaid-1',
        data: { tx_ref: 'txref-webhook-overpaid-1', status: 'successful', amount: 1250, currency: 'MWK' },
      });

      const response = await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook));
      assert.equal(response.status, 200);
      const result = await response.json() as { status?: string };
      assert.equal(result.status, 'ignored');
      assert.equal(orderRepository.findById('order_webhook_overpaid_1')?.status, 'pending_payment');
      assert.equal(paymentRepository.findByReference('txref-webhook-overpaid-1')?.verified, false);
      assert.equal(countEscrowsForOrder('order_webhook_overpaid_1'), 0);
    });
  } finally {
    global.fetch = originalFetch;
    clearPaymentState();
  }
});

test('financial integrity: successful webhook without an amount is ignored without settlement', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';

  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-webhook-missing-amount-1', 'successful', 1000);

  try {
    seedOrder('order_webhook_missing_amount_1', 'txref-webhook-missing-amount-1');
    seedStoredPayment('order_webhook_missing_amount_1', 'txref-webhook-missing-amount-1');

    await withServer(async (base) => {
      const rawWebhook = JSON.stringify({
        event_type: 'charge.success',
        event_id: 'evt_webhook_missing_amount_1',
        tx_ref: 'txref-webhook-missing-amount-1',
        data: { tx_ref: 'txref-webhook-missing-amount-1', status: 'successful', currency: 'MWK' },
      });

      const response = await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook));
      assert.equal(response.status, 200);
      const result = await response.json() as { status?: string };
      assert.equal(result.status, 'ignored');
      assert.equal(orderRepository.findById('order_webhook_missing_amount_1')?.status, 'pending_payment');
      assert.equal(paymentRepository.findByReference('txref-webhook-missing-amount-1')?.verified, false);
      assert.equal(countEscrowsForOrder('order_webhook_missing_amount_1'), 0);
    });
  } finally {
    global.fetch = originalFetch;
    clearPaymentState();
  }
});

test('recovery: valid webhook arriving before local payment is recovered when payment is created', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';

  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-early-webhook-1', 'successful', 1000);

  try {
    const orderId = 'order_early_webhook_1';
    const reference = 'txref-early-webhook-1';
    seedOrder(orderId, reference);

    await withServer(async (base) => {
      const rawWebhook = JSON.stringify({
        event_type: 'charge.success',
        event_id: 'evt_early_webhook_1',
        tx_ref: reference,
        data: { tx_ref: reference, status: 'successful', amount: 1000, currency: 'MWK' },
      });

      const webhookResponse = await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook));
      assert.equal(webhookResponse.status, 200);
      assert.equal(orderRepository.findById(orderId)?.status, 'pending_payment');
      assert.equal(paymentRepository.findByReference(reference), undefined);

      const initializeResponse = await initializePayment(base, orderId);
      assert.equal(initializeResponse.status, 201);

      const savedPayment = paymentRepository.findByReference(reference);
      assert.ok(savedPayment);
      assert.equal(savedPayment.verified, true);
      assert.equal(savedPayment.status, 'captured');
      assert.equal(orderRepository.findById(orderId)?.status, 'in_escrow');
      assert.equal(escrowRepository.findByOrderId(orderId)?.balanceAmount, 1000);
      assert.equal(countEscrowsForOrder(orderId), 1);
    });
  } finally {
    global.fetch = originalFetch;
    clearPaymentState();
  }
});

test('financial integrity: late success webhook cannot resurrect a refunded order', async () => {
  clearPaymentState();
  process.env.PAYCHANGU_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PAYCHANGU_SECRET_KEY = 'integration-secret-key';

  const originalFetch = global.fetch;
  global.fetch = mockPayChanguFetch(originalFetch, 'txref-late-success-after-refund-1', 'successful', 1000);

  try {
    const orderId = 'order_late_success_after_refund_1';
    const reference = 'txref-late-success-after-refund-1';
    seedOrder(orderId, reference, 'refunded');
    seedStoredPayment(orderId, reference);
    paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'refunded', verified: false }));

    const escrow = escrowRepository.create(orderId, 'MWK', 1000);
    escrowRepository.refundHeldBalance({ orderId, refundedBy: 'system-test', reference: 'refund-late-success-test' });

    await withServer(async (base) => {
      const rawWebhook = JSON.stringify({
        event_type: 'charge.success',
        event_id: 'evt_late_success_after_refund_1',
        tx_ref: reference,
        data: { tx_ref: reference, status: 'successful', amount: 1000, currency: 'MWK' },
      });

      const response = await postPayChanguWebhook(base, rawWebhook, signWebhook(rawWebhook));
      assert.equal(response.status, 200);
      assert.equal(orderRepository.findById(orderId)?.status, 'refunded');
      assert.equal(paymentRepository.findByReference(reference)?.status, 'refunded');
      assert.equal(paymentRepository.findByReference(reference)?.verified, false);
      assert.equal(escrowRepository.findById(escrow.id)?.state, 'refunded');
      assert.equal(countEscrowsForOrder(orderId), 1);
    });
  } finally {
    global.fetch = originalFetch;
    clearPaymentState();
  }
});

test('financial integrity: unsupported PayChangu refund fails safely without claiming a refund', async () => {
  const service = new ServerPaymentService();

  await assert.rejects(
    () => service.refund({
      paymentId: 'pay_refund_1',
      provider: 'paychangu',
      amount: { amount: 1000, currency: 'MWK' },
      reason: 'test refund',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Refunds are not available yet for this payment provider/);
      assert.equal((error as { status?: number }).status, 501);
      return true;
    },
  );
});
