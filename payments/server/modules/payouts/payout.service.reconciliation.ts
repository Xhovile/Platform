import './payout.schema.js';
import { getPaymentDb } from '../../postgresCompat.js';
import { getPayChanguPayoutStatus } from './paychangu.payout.js';
import { payoutRepository, type PayoutRepository } from './payout.repository.js';
import {
  exactProviderErrorMessage,
  type AdminOverrideAction,
  type PayoutRecord,
  type ReconcileProviderCallbackInput,
} from './payout.shared.js';

export async function reconcilePayoutStatusFlow(
  repository: PayoutRepository,
  input: {
    payoutId: string;
    actorType?: 'admin' | 'system';
    actorId?: string | null;
  },
) {
  const db = getPaymentDb();
  const row = db.prepare(
    `SELECT
       p.id,
       p.seller_id,
       p.provider_charge_id,
       p.status,
       p.requested_at,
       p.created_at,
       p.last_attempt_id,
       (
         SELECT provider_charge_id
         FROM payout_attempts pa
         WHERE pa.payout_id = p.id
         ORDER BY pa.attempt_no DESC
         LIMIT 1
       ) AS latest_attempt_charge_id
     FROM payouts p
     WHERE p.id = ?
     LIMIT 1`,
  ).get(input.payoutId) as Record<string, unknown> | undefined;

  if (!row) throw new Error('Payout not found');

  let chargeId = (row.provider_charge_id as string | null) ?? (row.latest_attempt_charge_id as string | null) ?? null;
  if (!chargeId) {
    const legacyAttempt = repository.ensureLegacyAttemptForReconciliation({
      payoutId: input.payoutId,
      actorType: input.actorType ?? 'admin',
      actorId: input.actorId ?? null,
    });
    chargeId = legacyAttempt.providerReference;
    if (!chargeId) {
      const payoutStatus = String(row.status ?? '').toLowerCase();
      if (payoutStatus === 'pending_settlement') {
        throw new Error('Payout is awaiting the PayChangu T+1 settlement window and has no provider attempt yet');
      }
      if (payoutStatus === 'ready_for_payout' || payoutStatus === 'queued') {
        throw new Error('Payout is queued for provider submission and has no provider attempt yet');
      }
      throw new Error('Payout has no provider attempt to reconcile');
    }
  }

  const status = await getPayChanguPayoutStatus(chargeId);
  const now = new Date().toISOString();
  const nextStatus = status.status;
  const exactMessage = exactProviderErrorMessage(status.rawResponse);

  repository.updateStatus(input.payoutId, nextStatus, {
    provider: 'paychangu',
    providerChargeId: chargeId,
    providerReference: status.reference,
    providerTransactionId: status.transactionId,
    providerStatus: status.status,
    rawResponse: status.rawResponse,
    paidAt: nextStatus === 'paid' ? now : null,
    failedAt: nextStatus === 'failed' ? now : null,
    failureReason: nextStatus === 'failed' ? 'provider_status_failed' : null,
    manualReviewReason: nextStatus === 'failed'
      ? exactMessage ?? 'Provider status sync reported payout failure'
      : null,
  });

  if (row.last_attempt_id) {
    db.prepare(
      `UPDATE payout_attempts
       SET status = ?,
           response_payload = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(nextStatus, JSON.stringify(status.rawResponse ?? {}), now, now, row.last_attempt_id as string);
  }

  repository.addEvent({
    payoutId: input.payoutId,
    sellerId: row.seller_id as string,
    eventType: 'payout_status_synced',
    actorType: input.actorType ?? 'admin',
    actorId: input.actorId ?? null,
    note: `Provider status sync recorded ${nextStatus}`,
    payload: {
      chargeId,
      providerReference: status.reference,
      providerTransactionId: status.transactionId,
      status: status.status,
      checkedAt: status.checkedAt,
    },
  });

  return { payout: repository.findById(input.payoutId), status };
}

export function reconcileProviderCallbackFlow(
  repository: PayoutRepository,
  input: ReconcileProviderCallbackInput,
): PayoutRecord | undefined {
  const db = getPaymentDb();
  const now = new Date().toISOString();
  const status = input.status;
  const failureReason = status === 'failed' ? 'Provider callback reported payout failure' : null;
  const rawResponse = JSON.stringify(input.rawPayload ?? {});

  const row = db.prepare(
    `SELECT id, seller_id
     FROM payouts
     WHERE id = ?
     LIMIT 1`,
  ).get(input.payoutId) as { id: string; seller_id: string } | undefined;

  if (!row) return undefined;

  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE payouts
       SET status = ?,
           provider = COALESCE(provider, 'paychangu'),
           provider_charge_id = COALESCE(?, provider_charge_id),
           provider_status = COALESCE(?, provider_status),
           provider_ref_id = COALESCE(?, provider_ref_id),
           provider_transaction_id = COALESCE(?, provider_transaction_id),
           raw_response = ?,
           paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
           failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
           failure_reason = CASE WHEN ? = 'failed' THEN ? ELSE failure_reason END,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      status,
      input.providerChargeId ?? null,
      status,
      input.providerReference ?? null,
      input.providerTransactionId ?? null,
      rawResponse,
      status,
      now,
      status,
      now,
      status,
      failureReason,
      now,
      input.payoutId,
    );

    const latestAttempt = db.prepare(
      `SELECT id
       FROM payout_attempts
       WHERE payout_id = ?
         AND (? IS NULL OR provider_charge_id = ?)
       ORDER BY attempt_no DESC, created_at DESC
       LIMIT 1`,
    ).get(input.payoutId, input.providerChargeId ?? null, input.providerChargeId ?? null) as { id: string } | undefined;

    if (latestAttempt) {
      db.prepare(
        `UPDATE payout_attempts
         SET status = ?,
             response_payload = ?,
             completed_at = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(status, rawResponse, now, now, latestAttempt.id);
    }

    repository.addEvent({
      payoutId: input.payoutId,
      sellerId: row.seller_id,
      eventType: 'payout_reconciled',
      actorType: 'system',
      actorId: null,
      note: 'Reconciled from provider callback',
      payload: {
        chargeId: input.providerChargeId ?? null,
        providerReference: input.providerReference ?? null,
        providerTransactionId: input.providerTransactionId ?? null,
        providerEventId: input.eventId ?? null,
        status,
      },
    });
  });

  transaction();
  return repository.findById(input.payoutId);
}

export async function reconcilePendingPayoutStatusesFlow(
  repository: PayoutRepository,
  input: { actorType?: 'admin' | 'system'; actorId?: string | null; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(50, Number(input.limit ?? 25) || 25));
  const rows = getPaymentDb().prepare(
    `SELECT id
     FROM payouts
     WHERE provider = 'paychangu'
       AND provider_charge_id IS NOT NULL
       AND status IN ('queued', 'processing', 'pending', 'held', 'failed')
     ORDER BY updated_at ASC
     LIMIT ?`,
  ).all(limit) as Array<{ id: string }>;

  const results: Array<
    | { ok: true; payoutId: string; payout: unknown; status: unknown }
    | { ok: false; payoutId: string; error: string }
  > = [];

  for (const row of rows) {
    try {
      const reconciled = await reconcilePayoutStatusFlow(repository, {
        payoutId: row.id,
        actorType: input.actorType,
        actorId: input.actorId,
      });
      results.push({ ok: true, payoutId: row.id, payout: reconciled.payout, status: reconciled.status });
    } catch (error) {
      results.push({ ok: false, payoutId: row.id, error: error instanceof Error ? error.message : 'Unknown reconcile error' });
    }
  }

  return results;
}

export function applyAdminOverrideFlow(
  repository: PayoutRepository,
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

  const existing = repository.findById(input.payoutId);
  if (!existing) return undefined;
  if (input.sellerId && existing.sellerId !== input.sellerId) throw new Error('Payout does not belong to the provided seller');

  const from = existing.status;
  const allowedTransitions: Record<AdminOverrideAction, ReadonlySet<PayoutRecord['status']>> = {
    hold: new Set(['eligible', 'queued', 'processing', 'pending', 'failed']),
    mark_paid: new Set(['held']),
    mark_failed: new Set(['eligible', 'queued', 'processing', 'pending', 'held']),
    cancel: new Set(['eligible', 'queued', 'processing', 'pending', 'failed', 'held']),
  } as const;
  if (!allowedTransitions[input.action].has(from)) throw new Error(`Invalid admin override transition from ${from} via ${input.action}`);

  let payout: PayoutRecord | undefined;
  if (input.action === 'mark_paid') {
    payout = repository.updateStatus(input.payoutId, 'paid', {
      paidAt: new Date().toISOString(),
      provider: 'paychangu',
      providerStatus: 'paid',
      processedBy: input.actorId,
      approvedBy: input.actorId,
      failureReason: null,
    });
  } else if (input.action === 'mark_failed') {
    payout = repository.updateStatus(input.payoutId, 'failed', {
      failureReason: reason,
      failedAt: new Date().toISOString(),
      provider: 'paychangu',
      providerStatus: 'failed',
      processedBy: input.actorId,
      approvedBy: input.actorId,
    });
  } else if (input.action === 'cancel') {
    payout = repository.updateStatus(input.payoutId, 'cancelled', {
      failureReason: 'payout_cancelled',
      failedAt: new Date().toISOString(),
      manualReviewReason: reason,
      processedBy: input.actorId,
      approvedBy: input.actorId,
    });
  } else {
    payout = repository.updateStatus(input.payoutId, 'held', {
      manualReviewReason: reason,
      providerStatus: 'held',
      processedBy: input.actorId,
      approvedBy: input.actorId,
    });
  }

  if (payout) {
    const eventType = input.action === 'mark_paid' ? 'admin_mark_paid' : input.action === 'mark_failed' ? 'admin_mark_failed' : input.action === 'cancel' ? 'admin_cancel' : 'admin_hold';
    repository.addEvent({ payoutId: input.payoutId, sellerId: payout.sellerId, eventType, actorType: 'admin', actorId: input.actorId, note: reason });
  }
  return payout;
}
