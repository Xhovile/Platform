import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import { createPayoutRouter } from '../../escrowRoutes.js';
import { getPaymentDb } from '../../../postgresCompat.js';

const sellerId = 'seller-manual-create-test';
const destinationId = 'destination-manual-create-test';

function now(): string {
  return new Date().toISOString();
}

function createApp(uid: string, isAdmin = true): express.Express {
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

function resetState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payout_events WHERE seller_id = ?').run(sellerId);
  db.prepare('DELETE FROM payout_attempts WHERE payout_id IN (SELECT id FROM payouts WHERE seller_id = ?)').run(sellerId);
  db.prepare('DELETE FROM payouts WHERE seller_id = ?').run(sellerId);
  db.prepare('DELETE FROM seller_payout_account_events WHERE seller_uid = ?').run(sellerId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE seller_uid = ?').run(sellerId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
}

function seedSellerAndDestination(): void {
  const db = getPaymentDb();
  db.prepare('INSERT INTO sellers (uid, email, is_verified) VALUES (?, ?, 1)').run(sellerId, `${sellerId}@example.com`);
  const stamp = now();
  db.prepare(
    `INSERT INTO seller_payout_accounts (
      id, seller_uid, destination_type, provider_name, provider_ref_id,
      currency, account_name, mobile_encrypted, masked_account, destination_fingerprint,
      is_default, verification_status, verification_attempts, is_active, created_at, updated_at
    ) VALUES (?, ?, 'mobile_money', 'paychangu', 'airtel-money', 'MWK', 'Manual Test', '0990000000', '****0000', ?, 1, 'verified', 0, 1, ?, ?)`,
  ).run(destinationId, sellerId, randomUUID(), stamp, stamp);
}

async function createManualPayout(payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = createApp('admin-manual-create', true);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/payouts`, {
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

test('manual payout creation requires admin reason', async () => {
  resetState();
  seedSellerAndDestination();

  const result = await createManualPayout({
    sellerId,
    amount: 1200,
    destinationAccountId: destinationId,
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'reason is required');
});

test('manual payout cannot bypass destination eligibility checks', async () => {
  resetState();
  seedSellerAndDestination();

  const result = await createManualPayout({
    sellerId,
    amount: 1600,
    destinationAccountId: 'missing-destination-id',
    reason: 'Manual payout with invalid destination should hold',
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.nextAction, 'manual_review');
  assert.equal(result.body.reasonCode, 'destination_not_verified');

  const db = getPaymentDb();
  const payout = db.prepare(
    'SELECT id, status, destination_account_id FROM payouts WHERE seller_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(sellerId) as { id: string; status: string; destination_account_id: string | null };

  assert.equal(payout.destination_account_id, 'missing-destination-id');
  assert.equal(payout.status, 'held');

  const events = db.prepare(
    `SELECT event_type FROM payout_events WHERE payout_id = ? ORDER BY id ASC`,
  ).all(payout.id) as Array<{ event_type: string }>;
  assert.deepEqual(events.map((row) => row.event_type), [
    'manual_payout_created',
    'payout_held',
  ]);

  const attempts = db.prepare('SELECT COUNT(*) AS count FROM payout_attempts WHERE payout_id = ?').get(payout.id) as { count: number };
  assert.equal(attempts.count, 0);
});
