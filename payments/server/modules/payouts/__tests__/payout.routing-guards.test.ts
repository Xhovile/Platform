import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutService } from '../payout.service.js';
import { executePayChanguPayout } from '../paychangu.payout.js';
import { serverOrderService } from '../../orders/order.service.js';
import { escrowRepository } from '../../escrow/escrow.repository.js';
import { getSellerPayoutStatusLabel } from '../../../../src/modules/payouts/uiModel.js';

function seedSubmissionPayout(prefix: string, destinationType: 'mobile_money' | 'bank', providerRefId: string | null) {
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

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended) VALUES (?, ?, 1, 0)`).run(sellerId, `${prefix}@example.com`);

  db.prepare(`INSERT INTO seller_payout_accounts (
    id, seller_uid, destination_type, provider_name, provider_ref_id, currency, account_name,
    account_number_encrypted, mobile_encrypted, masked_account, destination_fingerprint,
    is_default, verification_status, verification_attempts, is_active, created_at, updated_at
  ) VALUES (?, ?, ?, 'Provider', ?, 'MWK', 'Seller Name', ?, ?, '****', ?, 1, 'verified', 1, 1, ?, ?)`)
    .run(
      destinationId,
      sellerId,
      destinationType,
      providerRefId,
      destinationType === 'bank' ? '100200300' : null,
      destinationType === 'mobile_money' ? '265999100200' : null,
      randomUUID(),
      now,
      now,
    );

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
    id, seller_id, order_id, escrow_id, release_entry_id, destination_account_id,
    amount, currency, status, provider, requested_by, requested_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 1470, 'MWK', 'eligible', 'paychangu', 'system', ?, ?, ?)`)
    .run(payoutId, sellerId, orderId, escrow?.id ?? `${prefix}-escrow`, `${prefix}-release`, destinationId, now, now, now);

  return { payoutId };
}

test('missing mobile money routing ID blocks payout submission', async () => {
  const { payoutId } = seedSubmissionPayout('route-mobile-missing', 'mobile_money', null);
  const result = await payoutService.executePayout({ payoutId, actorType: 'admin', actorId: 'admin' });
  assert.equal(result.attempt, null);
  assert.equal(result.reasonCode, 'destination_incomplete');
});

test('missing bank UUID blocks payout submission', async () => {
  const { payoutId } = seedSubmissionPayout('route-bank-missing', 'bank', null);
  const result = await payoutService.executePayout({ payoutId, actorType: 'admin', actorId: 'admin' });
  assert.equal(result.attempt, null);
  assert.equal(result.reasonCode, 'destination_incomplete');
});

test('foreign seller destination cannot be used for payout execution', async () => {
  const db = getPaymentDb();
  const prefix = 'route-foreign-destination';
  const payoutId = `${prefix}-payout`;
  const orderId = `${prefix}-order`;
  const sellerId = `${prefix}-seller`;
  const foreignSellerId = `${prefix}-foreign-seller`;
  const foreignDestinationId = `${prefix}-foreign-destination`;
  const now = new Date().toISOString();

  db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
  db.prepare('DELETE FROM escrows WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE id = ?').run(foreignDestinationId);
  db.prepare('DELETE FROM sellers WHERE uid IN (?, ?)').run(sellerId, foreignSellerId);

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended)
              VALUES (?, ?, 1, 0), (?, ?, 1, 0)`).run(
    sellerId, `${prefix}@example.com`,
    foreignSellerId, `${prefix}-foreign@example.com`,
  );
  db.prepare(`INSERT INTO seller_payout_accounts (
      id, seller_uid, destination_type, provider_name, provider_ref_id, currency, account_name,
      mobile_encrypted, masked_account, destination_fingerprint, is_default,
      verification_status, verification_attempts, is_active, created_at, updated_at
    ) VALUES (?, ?, 'mobile_money', 'Provider', 'airtel-money', 'MWK', 'Foreign Seller',
      ?, '****9999', ?, 1, 'verified', 1, 1, ?, ?)`)
    .run(foreignDestinationId, foreignSellerId, '265999999999', randomUUID(), now, now);

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
    id, seller_id, order_id, escrow_id, release_entry_id, destination_account_id,
    amount, currency, status, provider, requested_by, requested_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 1470, 'MWK', 'eligible', 'paychangu', 'system', ?, ?, ?)`)
    .run(payoutId, sellerId, orderId, escrow?.id ?? `${prefix}-escrow`, `${prefix}-release`, foreignDestinationId, now, now, now);

  try {
    const result = await payoutService.executePayout({ payoutId, actorType: 'system', actorId: 'system' });
    assert.equal(result.attempt, null);
    assert.equal(result.reasonCode, 'destination_not_verified');

    const persisted = db.prepare('SELECT destination_account_id FROM payouts WHERE id = ?').get(payoutId) as { destination_account_id: string | null };
    assert.equal(persisted.destination_account_id, foreignDestinationId);
  } finally {
    db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
    db.prepare('DELETE FROM payout_events WHERE payout_id = ?').run(payoutId);
    db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
    db.prepare('DELETE FROM escrows WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM seller_payout_accounts WHERE id = ?').run(foreignDestinationId);
    db.prepare('DELETE FROM sellers WHERE uid IN (?, ?)').run(sellerId, foreignSellerId);
  }
});

test('seller payout status labels include settlement states', () => {
  assert.equal(getSellerPayoutStatusLabel('pending_settlement'), 'Awaiting settlement');
  assert.equal(getSellerPayoutStatusLabel('ready_for_payout'), 'Ready for payout');
});

test('valid routing ID is sent in provider payload and pending/processing stay in-flight', async () => {
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.PAYCHANGU_SECRET_KEY;
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';
  const bodies: Array<Record<string, unknown>> = [];
  let call = 0;

  global.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    call += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    bodies.push(body);
    return new Response(JSON.stringify({
      data: { transaction: { status: call === 1 ? 'pending' : 'processing' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const pendingResult = await executePayChanguPayout({
      payoutId: 'inflight-pending', sellerId: 's1', amount: 100, currency: 'MWK', providerName: 'paychangu',
      destinationReference: '265999100200', attemptNo: 1, destinationType: 'mobile_money', mobile: '265999100200', mobileMoneyOperatorRefId: 'airtel-money',
    });
    const processingResult = await executePayChanguPayout({
      payoutId: 'inflight-processing', sellerId: 's1', amount: 100, currency: 'MWK', providerName: 'paychangu',
      destinationReference: '265999100201', attemptNo: 1, destinationType: 'mobile_money', mobile: '265999100201', mobileMoneyOperatorRefId: 'tnm-money',
    });

    assert.equal(bodies[0]?.mobile_money_operator_ref_id, 'airtel-money');
    assert.equal(bodies[1]?.mobile_money_operator_ref_id, 'tnm-money');
    assert.equal(pendingResult.status, 'pending');
    assert.equal(processingResult.status, 'processing');
  } finally {
    global.fetch = originalFetch;
    if (originalSecretKey === undefined) {
      delete process.env.PAYCHANGU_SECRET_KEY;
    } else {
      process.env.PAYCHANGU_SECRET_KEY = originalSecretKey;
    }
  }
});

test('admin mark-paid does not mask blocked provider submission path', async () => {
  const { payoutId } = seedSubmissionPayout('route-admin-mask', 'mobile_money', null);
  const blocked = await payoutService.executePayout({ payoutId, actorType: 'admin', actorId: 'admin' });
  assert.equal(blocked.attempt, null);
  assert.equal(blocked.reasonCode, 'destination_incomplete');

  const held = payoutService.markHeld(payoutId, 'admin', 'manual review after blocked submission');
  assert.equal(held?.status, 'held');

  const paid = payoutService.markPaid(payoutId, 'admin', 'manual settlement');
  assert.equal(paid?.status, 'paid');

  const db = getPaymentDb();
  const attempts = db.prepare(`SELECT COUNT(*) AS count FROM payout_attempts WHERE payout_id = ?`).get(payoutId) as { count: number };
  assert.equal(attempts.count, 0);

  const holdEvent = db.prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ? AND event_type = 'admin_hold'`).get(payoutId) as { count: number };
  const markPaidEvent = db.prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ? AND event_type = 'admin_mark_paid'`).get(payoutId) as { count: number };
  assert.equal(holdEvent.count, 1);
  assert.equal(markPaidEvent.count, 1);
});
