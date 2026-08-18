import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createPayoutRouter } from '../../escrowRoutes.js';
import { getPaymentDb } from '../../../postgresCompat.js';

const sellerId = 'seller-override-test';
const now = () => new Date().toISOString();

function createPayoutApp(uid: string, isAdmin = false): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/payouts', createPayoutRouter((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      uid,
      email: `${uid}@example.com`,
      is_admin: isAdmin,
    };
    next();
  }));
  return app;
}

function clearOverrideState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payout_events WHERE seller_id = ?').run(sellerId);
  db.prepare('DELETE FROM payout_attempts WHERE payout_id IN (SELECT id FROM payouts WHERE seller_id = ?)').run(sellerId);
  db.prepare('DELETE FROM payouts WHERE seller_id = ?').run(sellerId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
}

function seedSeller(): void {
  getPaymentDb()
    .prepare('INSERT INTO sellers (uid, email, is_verified) VALUES (?, ?, 1)')
    .run(sellerId, `${sellerId}@example.com`);
}

function seedPayout(id: string, status: string): void {
  const db = getPaymentDb();
  const stamp = now();
  db.prepare(
    `INSERT INTO payouts (
      id, seller_id, amount, currency, status, requested_by, requested_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sellerId, 1500, 'MWK', status, 'seed', stamp, stamp, stamp);
}

function seedProviderAttemptMetadata(id: string): void {
  const db = getPaymentDb();
  const stamp = now();
  db.prepare(
    `UPDATE payouts
       SET provider_charge_id = ?,
           last_attempt_id = ?,
           provider = 'paychangu',
           provider_status = 'processing',
           updated_at = ?
     WHERE id = ?`,
  ).run(`${id}-A01`, `${id}-attempt-1`, stamp, id);
}

async function callOverride(
  app: express.Express,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/payouts/${sellerId}/override`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    server.close();
  }
}

test('non-admin is blocked from payout overrides', async () => {
  clearOverrideState();
  seedSeller();
  seedPayout('payout-override-non-admin', 'held');

  const result = await callOverride(createPayoutApp('seller-user', false), {
    payoutId: 'payout-override-non-admin',
    action: 'hold',
    reason: 'manual hold required',
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'Admin approval required');
});

test('override requires reason and rejects invalid action', async () => {
  clearOverrideState();
  seedSeller();
  seedPayout('payout-override-validation', 'held');
  const adminApp = createPayoutApp('admin-user', true);

  const missingReason = await callOverride(adminApp, {
    payoutId: 'payout-override-validation',
    action: 'mark_paid',
  });
  assert.equal(missingReason.status, 400);
  assert.equal(missingReason.body.error, 'reason is required');

  const invalidAction = await callOverride(adminApp, {
    payoutId: 'payout-override-validation',
    action: 'free_form',
    reason: 'invalid test',
  });
  assert.equal(invalidAction.status, 400);
  assert.equal(invalidAction.body.error, 'action must be one of: hold, mark_paid, mark_failed, cancel');
});

test('each override action updates state and emits one audit event with actor', async () => {
  clearOverrideState();
  seedSeller();
  const db = getPaymentDb();
  const cases = [
    { payoutId: 'payout-override-hold', start: 'queued', action: 'hold', expected: 'held', reason: 'Awaiting admin review', eventType: 'admin_hold' },
    { payoutId: 'payout-override-paid', start: 'held', action: 'mark_paid', expected: 'paid', reason: 'Provider settled externally', eventType: 'admin_mark_paid' },
    { payoutId: 'payout-override-failed', start: 'processing', action: 'mark_failed', expected: 'failed', reason: 'Provider rejected destination', eventType: 'admin_mark_failed' },
    { payoutId: 'payout-override-cancel', start: 'held', action: 'cancel', expected: 'cancelled', reason: 'Payout permanently withdrawn', eventType: 'admin_cancel' },
  ] as const;

  for (const testCase of cases) {
    seedPayout(testCase.payoutId, testCase.start);
    if (testCase.action === 'mark_paid') {
      seedProviderAttemptMetadata(testCase.payoutId);
    }
    const result = await callOverride(createPayoutApp('admin-override-actor', true), {
      payoutId: testCase.payoutId,
      action: testCase.action,
      reason: testCase.reason,
    });
    assert.equal(result.status, 200);
    assert.equal((result.body.payout as Record<string, unknown>).status, testCase.expected);

    const eventCount = db
      .prepare(`SELECT COUNT(*) AS count FROM payout_events WHERE payout_id = ?`)
      .get(testCase.payoutId) as { count: number };
    assert.equal(eventCount.count, 1, `${testCase.action} should emit one event`);
    const event = db.prepare(
      `SELECT event_type, actor_id FROM payout_events WHERE payout_id = ? LIMIT 1`,
    ).get(testCase.payoutId) as { event_type: string; actor_id: string | null };
    assert.equal(event.event_type, testCase.eventType);
    assert.equal(event.actor_id, 'admin-override-actor');
  }
});

test('invalid override transition is rejected', async () => {
  clearOverrideState();
  seedSeller();
  seedPayout('payout-override-transition', 'paid');
  const result = await callOverride(createPayoutApp('admin-user', true), {
    payoutId: 'payout-override-transition',
    action: 'mark_failed',
    reason: 'cannot fail paid payout',
  });
  assert.equal(result.status, 400);
  assert.match(String(result.body.error), /Invalid admin override transition/);
});
