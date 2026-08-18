import assert from 'node:assert/strict';
import test from 'node:test';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutRepository, payoutService } from '../payout.service.js';

const orderId = 'connect-order-test';
const sellerId = 'connect-seller-test';
const requestedBy = 'connect-system-test';

function resetState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payouts WHERE order_id = ?').run(orderId);
}

test('Connect payout candidate is idempotent by order without escrow fields', () => {
  resetState();

  const first = payoutService.createConnectPayoutCandidate({
    sellerId,
    orderId,
    amount: 925,
    grossAmount: 1000,
    platformFeeAmount: 30,
    processingFeeAmount: 20,
    reserveAmount: 10,
    reserveCapAmount: 100,
    manualAdjustmentAmount: 0,
    payoutFeeAmount: 15,
    sellerReceivesAmount: 925,
    netAmount: 925,
    formulaSnapshot: { grossAmount: 1000, netAmount: 925 },
    currency: 'MWK',
    requestedBy,
    destinationAccountId: null,
    snapshot: { source: 'connect' },
  }).payout;

  const second = payoutService.createConnectPayoutCandidate({
    sellerId,
    orderId,
    amount: 900,
    grossAmount: 1000,
    platformFeeAmount: 40,
    processingFeeAmount: 20,
    reserveAmount: 10,
    reserveCapAmount: 100,
    manualAdjustmentAmount: 0,
    payoutFeeAmount: 30,
    sellerReceivesAmount: 900,
    netAmount: 900,
    formulaSnapshot: { grossAmount: 1000, netAmount: 900 },
    currency: 'MWK',
    requestedBy,
  }).payout;

  assert.equal(second.id, first.id);
  assert.equal(second.amount, first.amount);
  assert.equal(second.status, 'pending_settlement');
  assert.equal(second.escrowId, null);
  assert.equal(second.releaseEntryId, null);

  const found = payoutRepository.findConnectPayoutByOrderId(orderId);
  assert.equal(found?.id, first.id);

  const rows = getPaymentDb().prepare(
    `SELECT escrow_id, release_entry_id, gross_amount, net_amount, formula_snapshot, raw_request
     FROM payouts
     WHERE order_id = ?`,
  ).all(orderId) as Array<Record<string, unknown>>;

  assert.equal(rows.length, 1);
  assert.equal(rows[0].escrow_id, null);
  assert.equal(rows[0].release_entry_id, null);
  assert.equal(rows[0].gross_amount, 1000);
  assert.equal(rows[0].net_amount, 925);
  assert.deepEqual(JSON.parse(String(rows[0].formula_snapshot)), { grossAmount: 1000, netAmount: 925 });
  assert.deepEqual(JSON.parse(String(rows[0].raw_request)), { source: 'connect' });

  resetState();
});
