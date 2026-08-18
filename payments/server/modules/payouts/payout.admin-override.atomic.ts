import { getPaymentDb } from '../../postgresCompat.js';
import { payoutRepository, type PayoutTransitionRepository } from './payout.transition-repository.js';
import type { AdminOverrideAction, PayoutRecord } from './payout.shared.js';

const ALLOWED_TRANSITIONS: Record<AdminOverrideAction, readonly PayoutRecord['status'][]> = {
  hold: ['eligible', 'queued', 'processing', 'pending', 'failed'],
  mark_paid: ['held'],
  mark_failed: ['eligible', 'queued', 'processing', 'pending', 'held'],
  cancel: ['eligible', 'queued', 'processing', 'pending', 'failed', 'held'],
};

function buildUpdate(action: AdminOverrideAction, actorId: string, reason: string) {
  const now = new Date().toISOString();
  if (action === 'mark_paid') {
    return {
      status: 'paid',
      provider: 'paychangu',
      providerStatus: 'paid',
      failureReason: null,
      manualReviewReason: null,
      processedBy: actorId,
      approvedBy: actorId,
      paidAt: now,
      failedAt: null,
    };
  }
  if (action === 'mark_failed') {
    return {
      status: 'failed',
      provider: 'paychangu',
      providerStatus: 'failed',
      failureReason: reason,
      manualReviewReason: reason,
      processedBy: actorId,
      approvedBy: actorId,
      paidAt: null,
      failedAt: now,
    };
  }
  if (action === 'cancel') {
    return {
      status: 'cancelled',
      provider: 'paychangu',
      providerStatus: 'cancelled',
      failureReason: 'payout_cancelled',
      manualReviewReason: reason,
      processedBy: actorId,
      approvedBy: actorId,
      paidAt: null,
      failedAt: now,
    };
  }
  return {
    status: 'held',
    provider: 'paychangu',
    providerStatus: 'held',
    failureReason: null,
    manualReviewReason: reason,
    processedBy: actorId,
    approvedBy: actorId,
    paidAt: null,
    failedAt: null,
  };
}

export function applyAdminOverrideAtomic(
  repository: PayoutTransitionRepository = payoutRepository,
  input: {
    payoutId: string;
    action: AdminOverrideAction;
    actorId: string;
    reason?: string | null;
    sellerId?: string | null;
  },
): PayoutRecord | undefined {
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new Error('reason is required');

  const db = getPaymentDb();
  return db.transaction(() => {
    const existing = repository.findById(input.payoutId);
    if (!existing) return undefined;
    if (input.sellerId && existing.sellerId !== input.sellerId) {
      throw new Error('Payout does not belong to the provided seller');
    }

    const allowed = ALLOWED_TRANSITIONS[input.action];
    const update = buildUpdate(input.action, input.actorId, reason);
    const placeholders = allowed.map(() => '?').join(', ');
    const result = db.prepare(
      `UPDATE payouts
       SET status = ?,
           provider = ?,
           provider_status = ?,
           failure_reason = ?,
           manual_review_reason = ?,
           processed_by = ?,
           approved_by = ?,
           paid_at = ?,
           failed_at = ?,
           updated_at = ?
       WHERE id = ?
         AND status IN (${placeholders})`,
    ).run(
      update.status,
      update.provider,
      update.providerStatus,
      update.failureReason,
      update.manualReviewReason,
      update.processedBy,
      update.approvedBy,
      update.paidAt,
      update.failedAt,
      new Date().toISOString(),
      input.payoutId,
      ...allowed,
    );

    if (result.changes !== 1) {
      throw new Error(`Invalid admin override transition from ${existing.status} via ${input.action}`);
    }

    const payout = repository.findById(input.payoutId);
    if (!payout) throw new Error('Payout not found after admin override');

    const eventType = input.action === 'mark_paid'
      ? 'admin_mark_paid'
      : input.action === 'mark_failed'
        ? 'admin_mark_failed'
        : input.action === 'cancel'
          ? 'admin_cancel'
          : 'admin_hold';

    repository.addEvent({
      payoutId: input.payoutId,
      sellerId: payout.sellerId,
      eventType,
      actorType: 'admin',
      actorId: input.actorId,
      note: reason,
    });

    return payout;
  })();
}