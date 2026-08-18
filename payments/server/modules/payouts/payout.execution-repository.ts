import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../../postgres.js';
import type { PoolClient } from 'pg';
import type { PayoutAttemptRecord, PayoutRecord, PayoutStatus } from './payout.shared.js';
import { buildPayChanguPayoutChargeId } from './payout.charge-id.js';

export type DbExecutor = Pick<PoolClient, 'query'>;

const ALLOWED: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
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
};

function assertTransition(from: PayoutStatus, to: PayoutStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Illegal payout state transition: ${from} -> ${to}`);
  }
}

function rowToPayout(row: Record<string, unknown>): PayoutRecord {
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

export async function gatePayoutForSubmission(payoutId: string): Promise<{
  row: Record<string, unknown> | undefined;
  fallbackDestination?: Record<string, unknown>;
}> {
  const result = await query<Record<string, unknown>>(
    `SELECT
       p.id, p.seller_id, p.amount, p.currency, p.status, p.provider, p.failure_reason,
       p.order_id, p.escrow_id, p.provider_charge_id,
       o.status AS order_status,
       e.state AS escrow_state,
       s.is_suspended AS seller_suspended,
       spa.destination_type,
       spa.provider_ref_id,
       spa.provider_name,
       spa.account_name,
       spa.masked_account,
       spa.account_number_encrypted,
       spa.mobile_encrypted,
       spa.verification_status,
       spa.is_active,
       spa.id AS destination_account_id,
       (SELECT COALESCE(MAX(attempt_no), 0) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS attempt_count
     FROM payouts p
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN escrows e ON e.id = p.escrow_id
     LEFT JOIN sellers s ON s.uid = p.seller_id
     LEFT JOIN seller_payout_accounts spa ON spa.id = p.destination_account_id
     WHERE p.id = $1 LIMIT 1`,
    [payoutId],
  );

  const row = result.rows[0];
  if (!row) return { row: undefined };

  const destinationUsable =
    Boolean(row.destination_type) &&
    String(row.verification_status ?? '').toLowerCase() === 'verified' &&
    Number(row.is_active ?? 0) === 1;

  if (destinationUsable) return { row };

  const fallback = await query<Record<string, unknown>>(
    `SELECT id, destination_type, provider_ref_id, provider_name, account_name,
            verification_status, is_active, account_number_encrypted, mobile_encrypted
     FROM seller_payout_accounts
     WHERE seller_uid = $1 AND is_active = 1 AND verification_status = 'verified'
     ORDER BY is_default DESC, updated_at DESC, created_at DESC LIMIT 1`,
    [row.seller_id],
  );

  return { row, fallbackDestination: fallback.rows[0] };
}

export async function updateDestinationAccount(
  payoutId: string,
  destinationAccountId: string,
  executor?: DbExecutor,
): Promise<void> {
  const run = (client: DbExecutor) => client.query(
    `UPDATE payouts SET destination_account_id = $1, updated_at = $2 WHERE id = $3`,
    [destinationAccountId, new Date().toISOString(), payoutId],
  ).then(() => undefined);
  if (executor) await run(executor); else await withTransaction(run);
}

export async function getPayout(payoutId: string, executor: DbExecutor = { query }): Promise<PayoutRecord | undefined> {
  const result = await executor.query<Record<string, unknown>>('SELECT * FROM payouts WHERE id = $1 LIMIT 1', [payoutId]);
  return result.rows[0] ? rowToPayout(result.rows[0]) : undefined;
}

export async function updatePayoutStatus(
  payoutId: string,
  status: PayoutStatus,
  extra: Record<string, unknown> = {},
  executor?: DbExecutor,
): Promise<PayoutRecord | undefined> {
  const run = async (client: DbExecutor) => {
    const current = await getPayout(payoutId, client);
    if (!current) return undefined;
    assertTransition(current.status, status);
    const now = new Date().toISOString();
    const result = await client.query<Record<string, unknown>>(
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
       WHERE id = $17 RETURNING *`,
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
        payoutId,
      ],
    );
    return result.rows[0] ? rowToPayout(result.rows[0]) : undefined;
  };
  return executor ? run(executor) : withTransaction(run);
}

export async function addPayoutEvent(
  input: { payoutId: string; sellerId: string; eventType: string; actorType: string; actorId?: string | null; note?: string | null; payload?: Record<string, unknown> | null },
  executor?: DbExecutor,
): Promise<void> {
  const run = (client: DbExecutor) => client.query(
    `INSERT INTO payout_events (payout_id,seller_id,event_type,actor_type,actor_id,note,payload,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.payoutId, input.sellerId, input.eventType, input.actorType, input.actorId ?? null, input.note ?? null, input.payload ? JSON.stringify(input.payload) : null, new Date().toISOString()],
  ).then(() => undefined);
  if (executor) await run(executor); else await withTransaction(run);
}

export async function reserveRetryAttempt(input: {
  payoutId: string;
  provider: string;
  actorType: 'admin' | 'system';
  actorId?: string | null;
}): Promise<{ id: string; attemptNo: number; providerChargeId: string; createdAt: string }> {
  return withTransaction(async (client) => {
    const current = await getPayout(input.payoutId, client);
    if (!current) throw new Error('Payout not found');

    const attemptResult = await client.query<{ max_attempt_no: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) AS max_attempt_no FROM payout_attempts WHERE payout_id = $1`,
      [input.payoutId],
    );
    const attemptNo = Number(attemptResult.rows[0]?.max_attempt_no ?? 0) + 1;
    const providerChargeId = buildPayChanguPayoutChargeId(input.payoutId, attemptNo);
    const id = randomUUID();
    const now = new Date().toISOString();

    await updatePayoutStatus(input.payoutId, 'processing', {
      provider: input.provider,
      providerChargeId,
      providerStatus: 'processing',
      approvedBy: input.actorType === 'admin' ? input.actorId ?? null : null,
      sentAt: now,
    }, client);

    await client.query(
      `INSERT INTO payout_attempts
       (id,payout_id,attempt_no,provider,provider_charge_id,request_payload,response_payload,status,sent_at,completed_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id,input.payoutId,attemptNo,input.provider,providerChargeId,JSON.stringify({payoutId:input.payoutId,attemptNo}),null,'processing',now,null,now,now],
    );

    return { id, attemptNo, providerChargeId, createdAt: now };
  });
}

export async function recordAttempt(
  id: string,
  execution: {
    provider: string;
    providerChargeId?: string | null;
    providerReference?: string | null;
    providerTransactionId?: string | null;
    attemptNo: number;
    status: string;
    rawResponse?: unknown;
    failureClass?: string | null;
    processedAt?: string;
  },
  executor?: DbExecutor,
): Promise<void> {
  const run = (client: DbExecutor) => client.query(
    `UPDATE payout_attempts
     SET provider=$1, provider_charge_id=$2, request_payload=$3, response_payload=$4,
         status=$5, failure_reason=$6, sent_at=$7, completed_at=$8, updated_at=$9
     WHERE id=$10`,
    [execution.provider, execution.providerChargeId ?? null,
      JSON.stringify({ attemptNo: execution.attemptNo, providerReference: execution.providerReference ?? null }),
      JSON.stringify(execution.rawResponse ?? {}), execution.status, execution.failureClass ?? null,
      execution.processedAt ?? new Date().toISOString(), execution.processedAt ?? new Date().toISOString(),
      new Date().toISOString(), id],
  ).then(() => undefined);
  if (executor) await run(executor); else await withTransaction(run);
}

export async function setPayoutDestinationIfNeeded(payoutId: string, destinationAccountId: string, executor?: DbExecutor): Promise<void> {
  await updateDestinationAccount(payoutId, destinationAccountId, executor);
}
