import assert from 'node:assert/strict';
import test from 'node:test';
import { getPaymentDb } from '../../../postgresCompat.js';
import { payoutRepository } from '../payout.repository.js';
import { PayoutStatusRepository } from '../payout.status-repository.js';

function seedPayout(id: string, status: string): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payouts WHERE id = ?').run(id);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO payouts (
      id, seller_id, order_id, escrow_id, release_entry_id, destination_account_id,
      amount, currency, status, provider, requested_by, requested_at, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, 1000, 'MWK', ?, 'paychangu', 'system', ?, ?, ?)
  `).run(id, `seller-${id}`, `order-${id}`, status, now, now, now);
}

function cleanup(id: string): void {
  getPaymentDb().prepare('DELETE FROM payouts WHERE id = ?').run(id);
}

test('payout state: paid cannot move backward', () => {
  const id = 'state-paid-terminal';
  seedPayout(id, 'paid');
  const statuses = new PayoutStatusRepository((payoutId) => payoutRepository.findById(payoutId));

  assert.throws(
    () => statuses.updateStatus(id, 'processing'),
    /Illegal payout state transition: paid -> processing/,
  );

  assert.equal(payoutRepository.findById(id)?.status, 'paid');
  cleanup(id);
});

test('payout state: cancelled is terminal', () => {
  const id = 'state-cancelled-terminal';
  seedPayout(id, 'cancelled');
  const statuses = new PayoutStatusRepository((payoutId) => payoutRepository.findById(payoutId));

  assert.throws(
    () => statuses.updateStatus(id, 'queued'),
    /Illegal payout state transition: cancelled -> queued/,
  );

  assert.equal(payoutRepository.findById(id)?.status, 'cancelled');
  cleanup(id);
});

test('payout state: failed may retry, then settle', () => {
  const id = 'state-failed-retry';
  seedPayout(id, 'failed');
  const statuses = new PayoutStatusRepository((payoutId) => payoutRepository.findById(payoutId));

  assert.equal(statuses.updateStatus(id, 'queued')?.status, 'queued');
  assert.equal(statuses.updateStatus(id, 'processing')?.status, 'processing');
  assert.equal(statuses.updateStatus(id, 'pending')?.status, 'pending');
  assert.equal(statuses.updateStatus(id, 'paid')?.status, 'paid');
  cleanup(id);
});

test('payout state: provider failure can move an in-flight payout to held for review', () => {
  const id = 'state-held-review';
  seedPayout(id, 'processing');
  const statuses = new PayoutStatusRepository((payoutId) => payoutRepository.findById(payoutId));

  assert.equal(statuses.updateStatus(id, 'held')?.status, 'held');
  assert.equal(statuses.updateStatus(id, 'queued')?.status, 'queued');
  cleanup(id);
});
