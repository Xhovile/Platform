import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'crypto';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutWebhookHandler } from '../payout.webhooks.js';

function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function seedWebhookPayout(prefix: string) {
  const db = getPaymentDb();
  const payoutId = `${prefix}-payout`;
  const sellerId = `${prefix}-seller`;
  const chargeId = `BM-PO-${payoutId}-A01`;
  const attemptId = `${prefix}-attempt`;
  const now = new Date().toISOString();

  db.prepare(`DELETE FROM payout_events WHERE payout_id = ?`).run(payoutId);
  db.prepare(`DELETE FROM payout_attempts WHERE payout_id = ?`).run(payoutId);
  db.prepare(`DELETE FROM payouts WHERE id = ?`).run(payoutId);
  db.prepare(`DELETE FROM sellers WHERE uid = ?`).run(sellerId);
  db.prepare(`DELETE FROM payment_webhook_events WHERE provider = 'paychangu_payout' AND reference = ?`).run(chargeId);

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended) VALUES (?, ?, 1, 0)`).run(
    sellerId,
    `${prefix}@example.com`,
  );

  db.prepare(`INSERT INTO payouts (
    id, seller_id, amount, currency, status, provider, provider_charge_id, requested_by, requested_at, last_attempt_id, created_at, updated_at
  ) VALUES (?, ?, 1470, 'MWK', 'processing', 'paychangu', ?, 'system', ?, ?, ?, ?)`).run(
    payoutId,
    sellerId,
    chargeId,
    now,
    attemptId,
    now,
    now,
  );

  db.prepare(`INSERT INTO payout_attempts (
    id, payout_id, attempt_no, provider, provider_charge_id, request_payload, response_payload, status, sent_at, created_at, updated_at
  ) VALUES (?, ?, 1, 'paychangu', ?, ?, NULL, 'processing', ?, ?, ?)`).run(
    attemptId,
    payoutId,
    chargeId,
    JSON.stringify({ payoutId, chargeId }),
    now,
    now,
    now,
  );

  return { payoutId, chargeId, attemptId };
}

function buildWebhookPayload(input: {
  eventId: string;
  status: string;
  chargeId: string;
  payoutId: string;
  providerReference?: string;
  providerTransactionId?: string;
}) {
  return JSON.stringify({
    event_type: 'charge.success',
    event_id: input.eventId,
    data: {
      transaction: {
        status: input.status,
        charge_id: input.chargeId,
        payout_reference: input.payoutId,
        reference: input.providerReference ?? `ref-${input.eventId}`,
        transaction_id: input.providerTransactionId ?? `txn-${input.eventId}`,
      },
    },
  });
}

test('paid payout webhook reconciles payout and latest attempt directly', async () => {
  const secret = `secret-${randomUUID()}`;
  process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET = secret;

  const { payoutId, chargeId, attemptId } = seedWebhookPayout('payout-webhook-paid');
  const payload = buildWebhookPayload({
    eventId: 'evt-payout-paid-1',
    status: 'successful',
    chargeId,
    payoutId,
    providerReference: 'provider-ref-paid',
    providerTransactionId: 'provider-txn-paid',
  });

  await payoutWebhookHandler.handlePaychanguWebhook(signPayload(secret, payload), payload);

  const db = getPaymentDb();
  const payout = db.prepare(
    `SELECT status, provider_status, provider_ref_id, provider_transaction_id, raw_response, paid_at, failed_at, failure_reason
     FROM payouts
     WHERE id = ?`,
  ).get(payoutId) as Record<string, string | null>;
  assert.equal(payout.status, 'paid');
  assert.equal(payout.provider_status, 'paid');
  assert.equal(payout.provider_ref_id, 'provider-ref-paid');
  assert.equal(payout.provider_transaction_id, 'provider-txn-paid');
  assert.ok(payout.raw_response?.includes('evt-payout-paid-1'));
  assert.ok(payout.paid_at);
  assert.equal(payout.failed_at, null);
  assert.equal(payout.failure_reason, null);

  const attempt = db.prepare(
    `SELECT status, response_payload, completed_at FROM payout_attempts WHERE id = ?`,
  ).get(attemptId) as Record<string, string | null>;
  assert.equal(attempt.status, 'paid');
  assert.ok(attempt.response_payload?.includes('provider-txn-paid'));
  assert.ok(attempt.completed_at);

  const event = db.prepare(
    `SELECT actor_type, actor_id, payload
     FROM payout_events
     WHERE payout_id = ? AND event_type = 'payout_reconciled'
     ORDER BY id DESC
     LIMIT 1`,
  ).get(payoutId) as { actor_type: string; actor_id: string | null; payload: string };
  assert.equal(event.actor_type, 'system');
  assert.equal(event.actor_id, null);
  assert.ok(event.payload.includes('evt-payout-paid-1'));
});

test('failed payout webhook records failure state and attempt response', async () => {
  const secret = `secret-${randomUUID()}`;
  process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET = secret;

  const { payoutId, chargeId, attemptId } = seedWebhookPayout('payout-webhook-failed');
  const payload = buildWebhookPayload({
    eventId: 'evt-payout-failed-1',
    status: 'failed',
    chargeId,
    payoutId,
    providerReference: 'provider-ref-failed',
    providerTransactionId: 'provider-txn-failed',
  });

  await payoutWebhookHandler.handlePaychanguWebhook(signPayload(secret, payload), payload);

  const db = getPaymentDb();
  const payout = db.prepare(
    `SELECT status, provider_status, provider_ref_id, provider_transaction_id, failed_at, paid_at, failure_reason, raw_response
     FROM payouts
     WHERE id = ?`,
  ).get(payoutId) as Record<string, string | null>;
  assert.equal(payout.status, 'failed');
  assert.equal(payout.provider_status, 'failed');
  assert.equal(payout.provider_ref_id, 'provider-ref-failed');
  assert.equal(payout.provider_transaction_id, 'provider-txn-failed');
  assert.ok(payout.failed_at);
  assert.equal(payout.paid_at, null);
  assert.equal(payout.failure_reason, 'Provider callback reported payout failure');
  assert.ok(payout.raw_response?.includes('evt-payout-failed-1'));

  const attempt = db.prepare(
    `SELECT status, response_payload, completed_at FROM payout_attempts WHERE id = ?`,
  ).get(attemptId) as Record<string, string | null>;
  assert.equal(attempt.status, 'failed');
  assert.ok(attempt.response_payload?.includes('provider-txn-failed'));
  assert.ok(attempt.completed_at);
});

test('pending payout webhook records non-terminal provider state without terminal timestamps', async () => {
  const secret = `secret-${randomUUID()}`;
  process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET = secret;

  const { payoutId, chargeId, attemptId } = seedWebhookPayout('payout-webhook-pending');
  const payload = buildWebhookPayload({
    eventId: 'evt-payout-pending-1',
    status: 'pending',
    chargeId,
    payoutId,
    providerReference: 'provider-ref-pending',
    providerTransactionId: 'provider-txn-pending',
  });

  await payoutWebhookHandler.handlePaychanguWebhook(signPayload(secret, payload), payload);

  const db = getPaymentDb();
  const payout = db.prepare(
    `SELECT status, provider_status, provider_ref_id, provider_transaction_id, paid_at, failed_at, failure_reason, raw_response
     FROM payouts
     WHERE id = ?`,
  ).get(payoutId) as Record<string, string | null>;
  assert.equal(payout.status, 'pending');
  assert.equal(payout.provider_status, 'pending');
  assert.equal(payout.provider_ref_id, 'provider-ref-pending');
  assert.equal(payout.provider_transaction_id, 'provider-txn-pending');
  assert.equal(payout.paid_at, null);
  assert.equal(payout.failed_at, null);
  assert.equal(payout.failure_reason, null);
  assert.ok(payout.raw_response?.includes('evt-payout-pending-1'));

  const attempt = db.prepare(
    `SELECT status, response_payload, completed_at FROM payout_attempts WHERE id = ?`,
  ).get(attemptId) as Record<string, string | null>;
  assert.equal(attempt.status, 'pending');
  assert.ok(attempt.response_payload?.includes('provider-txn-pending'));
  assert.ok(attempt.completed_at);
});

test('duplicate payout webhooks are acknowledged once and logged as duplicates', async () => {
  const secret = `secret-${randomUUID()}`;
  process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET = secret;

  const { payoutId, chargeId } = seedWebhookPayout('payout-webhook');
  const payload = buildWebhookPayload({
    eventId: 'evt-payout-1',
    status: 'successful',
    chargeId,
    payoutId,
  });
  const signature = signPayload(secret, payload);

  await payoutWebhookHandler.handlePaychanguWebhook(signature, payload);
  await payoutWebhookHandler.handlePaychanguWebhook(signature, payload);

  const db = getPaymentDb();
  const payout = db.prepare(`SELECT status FROM payouts WHERE id = ?`).get(payoutId) as { status: string };
  assert.equal(payout.status, 'paid');

  const reconciled = db.prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ? AND event_type = 'payout_reconciled'`).get(payoutId) as { count: number };
  const duplicates = db.prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ? AND event_type = 'payout_webhook_duplicate'`).get(payoutId) as { count: number };
  assert.equal(reconciled.count, 1);
  assert.equal(duplicates.count, 1);
});

test('same charge reference twice is deduplicated even with a different provider event id', async () => {
  const secret = `secret-${randomUUID()}`;
  process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET = secret;

  const { payoutId, chargeId } = seedWebhookPayout('payout-webhook-ref');
  const firstPayload = buildWebhookPayload({
    eventId: 'evt-payout-ref-1',
    status: 'successful',
    chargeId,
    payoutId,
  });
  const secondPayload = buildWebhookPayload({
    eventId: 'evt-payout-ref-2',
    status: 'successful',
    chargeId,
    payoutId,
  });

  await payoutWebhookHandler.handlePaychanguWebhook(signPayload(secret, firstPayload), firstPayload);
  await payoutWebhookHandler.handlePaychanguWebhook(signPayload(secret, secondPayload), secondPayload);

  const db = getPaymentDb();
  const duplicates = db.prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ? AND event_type = 'payout_webhook_duplicate'`).get(payoutId) as { count: number };
  assert.equal(duplicates.count, 1);
});

test('invalid payout webhook signature is rejected and audited on the payout timeline', async () => {
  const secret = `secret-${randomUUID()}`;
  process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET = secret;

  const { payoutId, chargeId } = seedWebhookPayout('payout-webhook-invalid');
  const payload = buildWebhookPayload({
    eventId: 'evt-payout-invalid-1',
    status: 'successful',
    chargeId,
    payoutId,
  });

  await assert.rejects(
    payoutWebhookHandler.handlePaychanguWebhook('bad-signature', payload),
    /Invalid PayChangu payout webhook signature/,
  );

  const db = getPaymentDb();
  const payout = db.prepare(`SELECT status, paid_at FROM payouts WHERE id = ?`).get(payoutId) as { status: string; paid_at: string | null };
  assert.equal(payout.status, 'processing');
  assert.equal(payout.paid_at, null);

  const rejected = db.prepare(
    `SELECT COUNT(*) AS count
     FROM payout_events
     WHERE payout_id = ?
       AND event_type = 'payout_webhook_rejected'`,
  ).get(payoutId) as { count: number };
  assert.equal(rejected.count, 1);
});
