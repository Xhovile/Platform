import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutService } from '../payout.service.js';
import { serverOrderService } from '../../orders/order.service.js';
import { escrowRepository } from '../../escrow/escrow.repository.js';

const payoutId = 'retry-payout-test';
const orderId = 'retry-order-test';
const sellerId = 'retry-seller-test';
const destinationId = 'retry-destination-test';

function setPayChanguSecretForTest(): string | undefined {
  const originalSecretKey = process.env.PAYCHANGU_SECRET_KEY;
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';
  return originalSecretKey;
}

function restorePayChanguSecretForTest(originalSecretKey: string | undefined): void {
  if (originalSecretKey === undefined) {
    delete process.env.PAYCHANGU_SECRET_KEY;
  } else {
    process.env.PAYCHANGU_SECRET_KEY = originalSecretKey;
  }
}

function resetState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payout_events WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
  db.prepare('DELETE FROM escrows WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE id = ?').run(destinationId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
}

function seedPayout(): void {
  const db = getPaymentDb();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended)
    VALUES (?, ?, 1, 0)`).run(sellerId, 'retry@example.com');

  db.prepare(`INSERT INTO seller_payout_accounts (
    id, seller_uid, destination_type, provider_name, provider_ref_id,
    currency, account_name, mobile_encrypted, masked_account, destination_fingerprint,
    is_default, verification_status, verification_attempts,
    is_active, created_at, updated_at
  ) VALUES (?, ?, 'mobile_money', 'Airtel Money', 'airtel-money',
    'MWK', 'Retry Seller', '265999111222', '****1222', ?,
    1, 'verified', 1,
    1, ?, ?)
  `).run(destinationId, sellerId, randomUUID(), now, now);

  serverOrderService.create({
    id: orderId,
    buyerId: 'buyer-retry-test',
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

  serverOrderService.setStatus(orderId, 'fulfilled');
  escrowRepository.create(orderId, 'MWK', 1500);
  escrowRepository.updateState(orderId, 'released');
  const escrow = escrowRepository.findByOrderId(orderId);

  db.prepare(`INSERT INTO payouts (
    id, seller_id, order_id, escrow_id, release_entry_id,
    destination_account_id, amount, currency, status,
    provider, requested_by, requested_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MWK', 'failed', 'paychangu', ?, ?, ?, ?)`)
  .run(
    payoutId,
    sellerId,
    orderId,
    escrow?.id ?? 'retry-escrow-id',
    'retry-release-entry',
    destinationId,
    1470,
    'admin-retry-test',
    now,
    now,
    now,
  );

  db.prepare(`UPDATE payouts SET failure_reason = 'provider_timeout' WHERE id = ?`).run(payoutId);
}

test('retry payout generates a fresh provider charge id per attempt', async () => {
  resetState();
  seedPayout();

  const originalFetch = global.fetch;
  const originalSecretKey = setPayChanguSecretForTest();
  let requestCount = 0;
  const requestBodies: Array<Record<string, unknown>> = [];

  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('/wallet-balance')) {
      return new Response(JSON.stringify({ data: { main_balance: 100000, currency: 'MWK' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    requestCount += 1;
    requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);

    return new Response(JSON.stringify({
      status: requestCount === 1 ? 'failed' : 'successful',
      data: {
        transaction: {
          status: requestCount === 1 ? 'failed' : 'successful',
        },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const first = await payoutService.executePayout({
      payoutId,
      actorType: 'admin',
      actorId: 'admin-1',
    });

    assert.ok(first.attempt);
    assert.equal(first.attempt?.attemptNo, 1);
    assert.match(first.attempt?.providerChargeId ?? '', /-A01$/);
    assert.equal(requestBodies[0]?.mobile, '265999111222');
    assert.equal(requestBodies[0]?.mobile_money_operator_ref_id, 'airtel-money');

    const db = getPaymentDb();
    db.prepare(`UPDATE payouts SET failure_reason = 'provider_timeout', status = 'failed' WHERE id = ?`).run(payoutId);

    const second = await payoutService.executePayout({
      payoutId,
      actorType: 'admin',
      actorId: 'admin-1',
    });

    assert.ok(second.attempt);
    assert.equal(second.attempt?.attemptNo, 2);
    assert.match(second.attempt?.providerChargeId ?? '', /-A02$/);
    assert.notEqual(first.attempt?.providerChargeId, second.attempt?.providerChargeId);

    const attempts = db.prepare(`SELECT provider_charge_id FROM payout_attempts WHERE payout_id = ? ORDER BY attempt_no ASC`).all(payoutId) as Array<{ provider_charge_id: string }>;
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0]?.provider_charge_id, attempts[1]?.provider_charge_id);
  } finally {
    global.fetch = originalFetch;
    restorePayChanguSecretForTest(originalSecretKey);
    resetState();
  }
});

test('concurrent retry calls do not reuse the same attempt_no', async () => {
  resetState();
  seedPayout();

  const originalFetch = global.fetch;
  const originalSecretKey = setPayChanguSecretForTest();
  let payoutRequestCount = 0;

  global.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/wallet-balance')) {
      return new Response(JSON.stringify({ data: { main_balance: 100000, currency: 'MWK' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    payoutRequestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({
      status: 'successful',
      data: { transaction: { status: 'successful' } },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      payoutService.executePayout({ payoutId, actorType: 'admin', actorId: 'admin-concurrent-1' }),
      payoutService.executePayout({ payoutId, actorType: 'admin', actorId: 'admin-concurrent-2' }),
    ]);

    assert.ok(first.attempt);
    assert.ok(second.attempt);
    const db = getPaymentDb();
    const attempts = db.prepare(
      `SELECT attempt_no
       FROM payout_attempts
       WHERE payout_id = ?
       ORDER BY attempt_no ASC`,
    ).all(payoutId) as Array<{ attempt_no: number }>;
    const groupedAttempts = db.prepare(
      `SELECT attempt_no, COUNT(*) AS count
       FROM payout_attempts
       WHERE payout_id = ?
       GROUP BY attempt_no
       ORDER BY attempt_no ASC`,
    ).all(payoutId) as Array<{ attempt_no: number; count: number }>;

    assert.equal(payoutRequestCount, 2);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map((row) => row.attempt_no), [1, 2]);
    assert.deepEqual(groupedAttempts.map((row) => row.count), [1, 1]);
  } finally {
    global.fetch = originalFetch;
    restorePayChanguSecretForTest(originalSecretKey);
    resetState();
  }
});
