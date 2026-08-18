import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutService } from '../payout.service.js';
import { serverOrderService } from '../../orders/order.service.js';
import { escrowRepository } from '../../escrow/escrow.repository.js';

function seedPayout(prefix: string, status: 'eligible' | 'failed' = 'eligible') {
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
    'MWK', 'Downtime Seller', '265999111444', '****1444', ?,
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
    requested_by, requested_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MWK', ?, 'paychangu', ?, ?, ?, ?)`).run(
    payoutId,
    sellerId,
    orderId,
    escrow?.id ?? `${prefix}-escrow`,
    `${prefix}-release`,
    destinationId,
    1470,
    status,
    'admin-downtime-test',
    now,
    now,
    now,
  );
  db.prepare(`UPDATE payouts SET failure_reason = NULL, manual_review_reason = NULL WHERE id = ?`).run(payoutId);

  return { payoutId, sellerId };
}

test('provider balance lookup timeout holds payout for manual review', async () => {
  const { payoutId } = seedPayout('balance-timeout');
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.PAYCHANGU_SECRET_KEY;
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';

  global.fetch = (async () => {
    throw new Error('provider timeout while checking wallet-balance');
  }) as typeof fetch;

  try {
    const result = await payoutService.executePayout({
      payoutId,
      actorType: 'admin',
      actorId: 'admin-timeout',
    });

    assert.equal(result.reasonCode, 'provider_timeout');
    assert.equal(result.nextAction, 'manual_review');

    const db = getPaymentDb();
    const payout = db.prepare(`SELECT status, failure_reason, manual_review_reason, paid_at FROM payouts WHERE id = ?`).get(payoutId) as {
      status: string;
      failure_reason: string | null;
      manual_review_reason: string | null;
      paid_at: string | null;
    };

    assert.equal(payout.status, 'held');
    assert.equal(payout.failure_reason, 'provider_timeout');
    assert.match(payout.manual_review_reason ?? '', /manual review/i);
    assert.equal(payout.paid_at, null);

    const attempts = db.prepare(`SELECT COUNT(*) AS count FROM payout_attempts WHERE payout_id = ?`).get(payoutId) as { count: number };
    assert.equal(attempts.count, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalSecretKey === undefined) {
      delete process.env.PAYCHANGU_SECRET_KEY;
    } else {
      process.env.PAYCHANGU_SECRET_KEY = originalSecretKey;
    }
  }
});

test('provider payout submission outage holds payout without writing paid state', async () => {
  const { payoutId } = seedPayout('submit-outage', 'failed');
  const db = getPaymentDb();
  db.prepare(`UPDATE payouts SET failure_reason = 'provider_timeout' WHERE id = ?`).run(payoutId);

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
    throw new Error('fetch failed: provider unavailable');
  }) as typeof fetch;

  try {
    const result = await payoutService.executePayout({
      payoutId,
      actorType: 'admin',
      actorId: 'admin-outage',
    });

    assert.equal(result.reasonCode, 'provider_unavailable');
    assert.equal(result.nextAction, 'retry_blocked');
    assert.ok(result.attempt);

    const payout = db.prepare(`SELECT status, failure_reason, manual_review_reason, paid_at, last_attempt_id FROM payouts WHERE id = ?`).get(payoutId) as {
      status: string;
      failure_reason: string | null;
      manual_review_reason: string | null;
      paid_at: string | null;
      last_attempt_id: string | null;
    };

    assert.equal(payout.status, 'held');
    assert.equal(payout.failure_reason, 'provider_unavailable');
    assert.match(payout.manual_review_reason ?? '', /provider outage|manual review/i);
    assert.equal(payout.paid_at, null);
    assert.ok(payout.last_attempt_id);
  } finally {
    global.fetch = originalFetch;
    if (originalSecretKey === undefined) {
      delete process.env.PAYCHANGU_SECRET_KEY;
    } else {
      process.env.PAYCHANGU_SECRET_KEY = originalSecretKey;
    }
  }
});
