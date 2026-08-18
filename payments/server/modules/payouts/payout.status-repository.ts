import { getPaymentDb } from '../../postgresCompat.js';
import { query } from '../../postgres.js';
import type { PoolClient } from 'pg';
import type { PayoutRecord, PayoutStatus } from './payout.shared.js';

const PAYOUT_ALLOWED_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  pending_settlement: ['pending_settlement', 'eligible', 'ready_for_payout', 'held', 'cancelled'],
  eligible: ['eligible', 'ready_for_payout', 'queued', 'held', 'cancelled'],
  ready_for_payout: ['ready_for_payout', 'queued', 'held', 'cancelled'],
  queued: ['queued', 'processing', 'pending', 'paid', 'failed', 'held', 'cancelled'],
  processing: ['processing', 'pending', 'paid', 'failed', 'held', 'cancelled'],
  pending: ['pending', 'processing', 'paid', 'failed', 'held', 'cancelled'],
  held: ['held', 'eligible', 'ready_for_payout', 'queued', 'processing', 'pending', 'paid', 'failed', 'cancelled'],
  paid: ['paid'],
  failed: ['failed', 'eligible', 'ready_for_payout', 'queued', 'processing', 'pending', 'held', 'cancelled'],
  cancelled: ['cancelled'],
} as const;

function assertPayoutStatusTransition(from: PayoutStatus, to: PayoutStatus): void {
  if (PAYOUT_ALLOWED_TRANSITIONS[from].includes(to)) return;
  throw new Error(`Illegal payout state transition: ${from} -> ${to}`);
}

export class PayoutStatusRepository {
  constructor(
    private readonly findById: (id: string) => PayoutRecord | undefined,
  ) {}

  updateStatus(
    id: string,
    status: PayoutStatus,
    extra: Record<string, unknown> = {},
  ): PayoutRecord | undefined {
    const current = this.findById(id);
    if (!current) return undefined;
    assertPayoutStatusTransition(current.status, status);

    const now = new Date().toISOString();
    const db = getPaymentDb();

    db.prepare(
      `UPDATE payouts
        SET status = ?,
             provider = COALESCE(?, provider),
             provider_charge_id = COALESCE(?, provider_charge_id),
             provider_ref_id = COALESCE(?, provider_ref_id),
             provider_status = COALESCE(?, provider_status),
             provider_transaction_id = COALESCE(?, provider_transaction_id),
             failure_reason = COALESCE(?, failure_reason),
             manual_review_reason = COALESCE(?, manual_review_reason),
             processed_by = COALESCE(?, processed_by),
             approved_by = COALESCE(?, approved_by),
             last_attempt_id = COALESCE(?, last_attempt_id),
             raw_response = COALESCE(?, raw_response),
             sent_at = COALESCE(?, sent_at),
             paid_at = COALESCE(?, paid_at),
             failed_at = COALESCE(?, failed_at),
             updated_at = ?
        WHERE id = ?`,
    ).run(
      status,
      extra.provider ?? null,
      extra.providerChargeId ?? null,
      extra.providerReference ?? null,
      extra.providerStatus ?? null,
      extra.providerTransactionId ?? null,
      extra.failureReason ?? null,
      extra.manualReviewReason ?? null,
      extra.processedBy ?? null,
      extra.approvedBy ?? null,
      extra.lastAttemptId ?? null,
      extra.rawResponse ? JSON.stringify(extra.rawResponse) : null,
      extra.sentAt ?? null,
      extra.paidAt ?? null,
      extra.failedAt ?? null,
      now,
      id,
    );

    return this.findById(id);
  }

  async updateStatusAsync(
    id: string,
    status: PayoutStatus,
    extra: Record<string, unknown> = {},
    executor: Pick<PoolClient, 'query'> = { query },
    current?: PayoutRecord,
  ): Promise<PayoutRecord | undefined> {
    const existing = current ?? (await executor.query<Record<string, unknown>>('SELECT * FROM payouts WHERE id = $1 LIMIT 1', [id])).rows[0];
    if (!existing) return undefined;
    const existingStatus = (existing.status as PayoutStatus) ?? 'pending_settlement';
    assertPayoutStatusTransition(existingStatus, status);

    const now = new Date().toISOString();
    const result = await executor.query<Record<string, unknown>>(
      `UPDATE payouts
       SET status = $1,
           provider = COALESCE($2, provider),
           provider_charge_id = COALESCE($3, provider_charge_id),
           provider_ref_id = COALESCE($4, provider_ref_id),
           provider_status = COALESCE($5, provider_status),
           provider_transaction_id = COALESCE($6, provider_transaction_id),
           failure_reason = COALESCE($7, failure_reason),
           manual_review_reason = COALESCE($8, manual_review_reason),
           processed_by = COALESCE($9, processed_by),
           approved_by = COALESCE($10, approved_by),
           last_attempt_id = COALESCE($11, last_attempt_id),
           raw_response = COALESCE($12, raw_response),
           sent_at = COALESCE($13, sent_at),
           paid_at = COALESCE($14, paid_at),
           failed_at = COALESCE($15, failed_at),
           updated_at = $16
       WHERE id = $17
       RETURNING *`,
      [
        status,
        extra.provider ?? null,
        extra.providerChargeId ?? null,
        extra.providerReference ?? null,
        extra.providerStatus ?? null,
        extra.providerTransactionId ?? null,
        extra.failureReason ?? null,
        extra.manualReviewReason ?? null,
        extra.processedBy ?? null,
        extra.approvedBy ?? null,
        extra.lastAttemptId ?? null,
        extra.rawResponse ? JSON.stringify(extra.rawResponse) : null,
        extra.sentAt ?? null,
        extra.paidAt ?? null,
        extra.failedAt ?? null,
        now,
        id,
      ],
    );

    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      sellerId: row.seller_id as string,
      orderId: (row.order_id as string | null) ?? null,
      escrowId: (row.escrow_id as string | null) ?? null,
      releaseEntryId: (row.release_entry_id as string | null) ?? null,
      destinationAccountId: (row.destination_account_id as string | null) ?? null,
      amount: Number(row.amount ?? 0),
      currency: String(row.currency ?? 'MWK'),
      status: row.status as PayoutStatus,
      provider: (row.provider as string | null) ?? null,
      providerChargeId: (row.provider_charge_id as string | null) ?? null,
      providerStatus: (row.provider_status as string | null) ?? null,
      requestedBy: (row.requested_by as string | null) ?? null,
      requestedAt: (row.requested_at as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
