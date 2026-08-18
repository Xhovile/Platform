import test from 'node:test';
import assert from 'node:assert/strict';
import { PayoutTransitionRepository } from '../payout.transition-repository.js';
import { getPaymentDb } from '../../../postgresCompat.js';

test('transition repository rejects an illegal payout status change', () => {
  const db = getPaymentDb();
  const repository = new PayoutTransitionRepository();
  const sellerId = 'seller_transition_repo';
  const payoutId = 'payout_transition_repo';

  db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);

  try {
    db.prepare('INSERT INTO sellers (uid, email) VALUES (?, ?)').run(sellerId, 'transition-repo@example.com');
    db.prepare(`
      INSERT INTO payouts (
        id, seller_id, order_id, amount, net_amount, currency, status,
        requested_by, requested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payoutId,
      sellerId,
      'order_transition_repo',
      970,
      970,
      'MWK',
      'paid',
      'system',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );

    assert.throws(
      () => repository.updateStatus(payoutId, 'processing'),
      /Illegal payout status transition/i,
    );

    assert.equal(repository.findById(payoutId)?.status, 'paid');
  } finally {
    db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
    db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
    db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
  }
});

test('transition repository preserves the existing processing idempotency guard', () => {
  const db = getPaymentDb();
  const repository = new PayoutTransitionRepository();
  const sellerId = 'seller_transition_repo_processing';
  const payoutId = 'payout_transition_repo_processing';

  db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
  db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);

  try {
    db.prepare('INSERT INTO sellers (uid, email) VALUES (?, ?)').run(sellerId, 'transition-processing@example.com');
    db.prepare(`
      INSERT INTO payouts (
        id, seller_id, order_id, amount, net_amount, currency, status,
        requested_by, requested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payoutId,
      sellerId,
      'order_transition_repo_processing',
      970,
      970,
      'MWK',
      'pending_settlement',
      'system',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );

    assert.ok(repository.updateStatus(payoutId, 'processing'));
    assert.throws(
      () => repository.updateStatus(payoutId, 'processing'),
      /already processing/i,
    );
  } finally {
    db.prepare('DELETE FROM payout_attempts WHERE payout_id = ?').run(payoutId);
    db.prepare('DELETE FROM payouts WHERE id = ?').run(payoutId);
    db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
  }
});
