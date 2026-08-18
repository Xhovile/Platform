import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createPaymentAdminRouter } from '../../../modules/payments/payment.admin.routes.js';
import { getPaymentDb } from '../../../postgresCompat.js';

const payoutId = 'payout-adjustment-test';
const sellerId = 'seller-adjustment-test';

function createAdminApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createPaymentAdminRouter((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      uid: 'admin-adjustment-test',
      email: 'admin@test.local',
      is_admin: true,
    };
    next();
  }));
  return app;
}

function clearState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payout_adjustments WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payout_events WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE seller_uid = ?').run(sellerId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
}

test('legacy processing fee storage and manual adjustments recalculate payout formula and emit audit event', async () => {
  clearState();

  const db = getPaymentDb();

  db.prepare(
    `INSERT INTO sellers (uid, email)
     VALUES (?, ?)`
  ).run(sellerId, 'seller@test.local');

  db.prepare(
    `INSERT INTO payouts (
      id,
      seller_id,
      order_id,
      escrow_id,
      release_entry_id,
      amount,
      currency,
      status,
      provider,
      gross_amount,
      platform_fee_amount,
      processing_fee_amount,
      reserve_amount,
      reserve_cap_amount,
      manual_adjustment_amount,
      net_amount,
      formula_snapshot,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    payoutId,
    sellerId,
    'order-adjustment-test',
    'escrow-adjustment-test',
    'release-adjustment-test',
    9700,
    'MWK',
    'eligible',
    'paychangu',
    10000,
    300,
    0,
    0,
    600,
    0,
    9700,
    JSON.stringify({
      grossAmount: 10000,
      platformFeeAmount: 300,
      processingFeeAmount: 0,
      reserveAmount: 0,
      reserveCapAmount: 600,
      manualAdjustmentAmount: 0,
      netAmount: 9700,
      currency: 'MWK',
    }),
  );

  const app = createAdminApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const processingFeeResponse = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${payoutId}/adjustments`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        adjustmentType: 'processing_fee',
        amount: 150,
        reason: 'Legacy provider fee record',
        providerReference: 'paychangu-fee-ref',
      }),
    });

    assert.equal(processingFeeResponse.status, 200);

    const manualAdjustmentResponse = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${payoutId}/adjustments`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        adjustmentType: 'manual_adjustment',
        amount: 50,
        reason: 'Operational payout correction',
      }),
    });

    assert.equal(manualAdjustmentResponse.status, 200);

    const payoutRow = db.prepare(
      `SELECT processing_fee_amount, manual_adjustment_amount, net_amount, formula_snapshot
       FROM payouts
       WHERE id = ? LIMIT 1`
    ).get(payoutId) as {
      processing_fee_amount: number;
      manual_adjustment_amount: number;
      net_amount: number;
      formula_snapshot: string;
    };

    assert.equal(payoutRow.processing_fee_amount, 150);
    assert.equal(payoutRow.manual_adjustment_amount, 50);
    assert.equal(payoutRow.net_amount, 9650);

    const snapshot = JSON.parse(payoutRow.formula_snapshot);
    assert.equal(snapshot.processingFeeAmount, 0);
    assert.equal(snapshot.manualAdjustmentAmount, 50);
    assert.equal(snapshot.netAmount, 9650);

    const adjustments = db.prepare(
      `SELECT adjustment_type, amount, reason
       FROM payout_adjustments
       WHERE payout_id = ?
       ORDER BY id ASC`
    ).all(payoutId) as Array<{
      adjustment_type: string;
      amount: number;
      reason: string;
    }>;

    assert.equal(adjustments.length, 2);
    assert.equal(adjustments[0]?.adjustment_type, 'processing_fee');
    assert.equal(adjustments[1]?.adjustment_type, 'manual_adjustment');

    const events = db.prepare(
      `SELECT event_type, actor_type
       FROM payout_events
       WHERE payout_id = ?
       ORDER BY id ASC`
    ).all(payoutId) as Array<{
      event_type: string;
      actor_type: string;
    }>;

    assert.ok(events.some((event) => event.event_type === 'payout_adjusted'));
    assert.ok(events.every((event) => event.actor_type === 'admin'));
  } finally {
    server.close();
    clearState();
  }
});
