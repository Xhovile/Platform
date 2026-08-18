import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutService } from '../payout.service.js';
import { PAYOUT_POLICY } from '../payout.policy.js';
import { buildPayChanguPayoutChargeId } from '../paychangu.payout.js';
import { serverOrderService } from '../../orders/order.service.js';
import { escrowRepository } from '../../escrow/escrow.repository.js';

function seedRetryPayout(prefix: string) {
  const db = getPaymentDb();
  const payoutId = `${prefix}-payout`;
  const orderId = `${prefix}-order`;
  const sellerId = `${prefix}-seller`;
  const destinationId = `${prefix}-destination`;
  const now = new Date().toISOString();

  db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payout_events WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
  db.prepare('DELETE FROM escrows WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE id = ?').run(destinationId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended)
    VALUES (?, ?, 1, 0)`).run(sellerId, `${prefix}@example.com`);

  db.prepare(`INSERT INTO seller_payout_accounts (
    id, seller_uid, destination_type, provider_name, provider_ref_id,
    currency, account_name, mobile_encrypted, masked_account, destination_fingerprint,
    is_default, verification_status, verification_attempts,
    is_active, created_at, updated_at
  ) VALUES (?, ?, 'mobile_money', 'Airtel Money', 'airtel-money',
    'MWK', 'Retry Audit Seller', '265999111555', '****1555', ?,
    1, 'verified', 1,
    1, ?, ?)
  `).run(destinationId, sellerId, randomUUID(), now, now);

  serverOrderService.create({
    id: orderId,
    buyerId: `${prefix}-buyer`,
    sellerId,
    source: 'listing',
    status: 'fulfilled',
    currency: 'MWK',
    subtotal: { amount: 1500, currency: 'MWK' },
    total: { amount: 1500, currency: 'MWK' },
    items: [],
    createdAt: now,
    updatedAt: now,
  });
  db.prepare(`UPDATE orders SET status = 'fulfilled' WHERE id = ?`).run(orderId);

  escrowRepository.create(orderId, 'MWK', 1500);
  escrowRepository.updateState(orderId, 'released');
  const escrow = escrowRepository.findByOrderId(orderId);

  db.prepare(`INSERT INTO payouts (
    id, seller_id, order_id, escrow_id, release_entry_id,
    destination_account_id, amount, currency, status, provider,
    failure_reason, requested_by, requested_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MWK', 'failed', 'paychangu', 'provider_timeout', ?, ?, ?, ?)`).run(
    payoutId,
    sellerId,
    orderId,
    escrow?.id ?? `${prefix}-escrow`,
    `${prefix}-release`,
    destinationId,
    1470,
    'admin-retry-audit',
    now,
    now,
    now,
  );

  db.prepare(`INSERT INTO payout_attempts (
    id, payout_id, attempt_no, provider, provider_charge_id, request_payload,
    response_payload, status, failure_reason, sent_at, completed_at, created_at, updated_at
  ) VALUES (?, ?, 1, 'paychangu', ?, '{}', '{}', 'failed', 'provider_timeout', ?, ?, ?, ?)`).run(
    `${prefix}-attempt-1`,
    payoutId,
    buildPayChanguPayoutChargeId(payoutId, 1),
    now,
    now,
    now,
    now,
  );

  return { payoutId };
}

test('retry writes one normalized payout_retried audit event with fresh charge id', async () => {
  const { payoutId } = seedRetryPayout('retry-audit');
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.PAYCHANGU_SECRET_KEY;
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';

  global.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/wallet-balance')) {
      return new Response(JSON.stringify({ data: { main_balance: 100000, currency: 'MWK' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      status: 'successful',
      data: { transaction: { status: 'successful' } },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await payoutService.executePayout({
      payoutId,
      actorType: 'admin',
      actorId: 'admin-retry-audit',
    });

    const db = getPaymentDb();
    const rows = db.prepare(`SELECT payload FROM payout_events WHERE payout_id = ? AND event_type = 'payout_retried'`).all(payoutId) as Array<{ payload: string }>;
    assert.equal(rows.length, 1);

    const payload = JSON.parse(rows[0]!.payload) as {
      attemptNo: number;
      providerChargeId: string;
      previousFailureReason: string;
      actorType: string;
    };

    assert.equal(payload.attemptNo, 2);
    assert.equal(payload.actorType, 'admin');
    assert.equal(payload.previousFailureReason, 'provider_timeout');
    assert.equal(payload.providerChargeId, buildPayChanguPayoutChargeId(payoutId, 2));
  } finally {
    global.fetch = originalFetch;
    if (originalSecretKey === undefined) {
      delete process.env.PAYCHANGU_SECRET_KEY;
    } else {
      process.env.PAYCHANGU_SECRET_KEY = originalSecretKey;
    }
  }
});

test('retry is blocked without writing payout_retried when retry limit is reached', async () => {
  const { payoutId } = seedRetryPayout('retry-limit');
  const db = getPaymentDb();
  const now = new Date().toISOString();

  for (let attemptNo = 2; attemptNo <= PAYOUT_POLICY.maxRetryCount; attemptNo += 1) {
    db.prepare(`INSERT INTO payout_attempts (
      id, payout_id, attempt_no, provider, provider_charge_id, request_payload,
      response_payload, status, failure_reason, sent_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'paychangu', ?, '{}', '{}', 'failed', 'provider_timeout', ?, ?, ?, ?)`).run(
      `retry-limit-attempt-${attemptNo}`,
      payoutId,
      attemptNo,
      buildPayChanguPayoutChargeId(payoutId, attemptNo),
      now,
      now,
      now,
      now,
    );
  }

  const result = await payoutService.executePayout({
    payoutId,
    actorType: 'admin',
    actorId: 'admin-retry-limit',
  });

  assert.equal(result.attempt, null);
  assert.equal(result.reasonCode, 'manual_review_required');

  const rows = db.prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ? AND event_type = 'payout_retried'`).get(payoutId) as { count: number };
  assert.equal(rows.count, 0);
});
