import express, { type RequestHandler } from 'express';
import { hasAdminAccess } from '../../auth/adminAccess.js';
import { getPaymentDb } from '../../postgresCompat.js';
import { payoutLimiter } from '../../routes/escrow/shared.js';
import { PAYOUT_POLICY, isRetryableFailureCode } from '../payouts/payout.policy.js';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!hasAdminAccess(req.user)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function findDefaultVerifiedDestination(db: ReturnType<typeof getPaymentDb>, sellerId: string) {
  return db.prepare(
    `SELECT
       id,
       destination_type AS destinationType,
       masked_account AS maskedAccount,
       verification_status AS verificationStatus,
       is_active AS isActive,
       last_error AS lastError
     FROM seller_payout_accounts
     WHERE seller_uid = ?
       AND is_active = 1
       AND verification_status = 'verified'
     ORDER BY is_default DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
  ).get(sellerId) as
    | {
        id: string;
        destinationType: string | null;
        maskedAccount: string | null;
        verificationStatus: string | null;
        isActive: number | null;
        lastError: string | null;
      }
    | undefined;
}

function hydratePayoutRow(db: ReturnType<typeof getPaymentDb>, row: Record<string, unknown>) {
  const sellerId =
    normalizeText(row.sellerId ?? row.seller_id) ??
    normalizeText(row.orderSellerId ?? row.order_seller_id) ??
    '';

  const currentDestinationAccountId = normalizeText(row.destinationAccountId ?? row.destination_account_id) ?? null;
  const currentDestinationStatus = String(row.destinationVerificationStatus ?? row.destination_verification_status ?? 'missing').toLowerCase();
  const currentDestinationActive = Number(row.destinationActive ?? row.destination_active ?? row.destinationIsActive ?? row.destination_is_active ?? 0) === 1;
  const fallbackDestination = sellerId ? findDefaultVerifiedDestination(db, sellerId) : undefined;
  const currentDestinationIsUnverified = currentDestinationStatus !== 'verified';
  const useFallbackDestination =
    !currentDestinationAccountId ||
    currentDestinationIsUnverified ||
    !currentDestinationActive;
  const destination = useFallbackDestination && fallbackDestination ? fallbackDestination : null;

  const destinationAccountId = destination?.id ?? currentDestinationAccountId;
  const destinationType = destination?.destinationType ?? normalizeText(row.destinationType ?? row.destination_type) ?? null;
  const destinationMaskedAccount = destination?.maskedAccount ?? normalizeText(row.destinationMaskedAccount ?? row.destination_masked_account) ?? null;
  const destinationVerificationStatus = (destination?.verificationStatus ?? normalizeText(row.destinationVerificationStatus ?? row.destination_verification_status) ?? 'missing').toLowerCase();
  const destinationActive = destination ? Number(destination.isActive ?? 1) === 1 : currentDestinationActive;
  const destinationLastError = destination?.lastError ?? normalizeText(row.destinationLastError ?? row.destination_last_error) ?? null;

  const status = String(row.currentState ?? row.status ?? '').toLowerCase();
  const failureReason = normalizeText(row.failureReason ?? row.failure_reason) ?? null;
  const attemptCount = Number(row.attemptCount ?? row.attempt_count ?? 0);
  const sellerSuspended = Number(row.sellerSuspended ?? row.seller_suspended ?? 0) === 1;

  const verificationBlockers: string[] = [];
  if (sellerSuspended) {
    verificationBlockers.push('Seller payouts are suspended');
  }
  if (destinationVerificationStatus !== 'verified' || !destinationActive) {
    verificationBlockers.push(
      destinationVerificationStatus === 'failed'
        ? 'Destination verification failed'
        : destinationVerificationStatus === 'disabled' || !destinationActive
          ? 'Destination is disabled'
          : 'Destination pending verification',
    );
  }

  const hasRetryableFailureContext =
    status === 'held'
      ? !failureReason || isRetryableFailureCode(failureReason)
      : isRetryableFailureCode(failureReason);

  const retryEligible =
    (status === 'failed' || status === 'held') &&
    attemptCount < PAYOUT_POLICY.maxRetryCount &&
    hasRetryableFailureContext &&
    !sellerSuspended &&
    destinationVerificationStatus === 'verified' &&
    destinationActive;

  const retryBlockedReason = retryEligible
    ? null
    : sellerSuspended
      ? 'Seller payouts are suspended'
      : destinationVerificationStatus !== 'verified' || !destinationActive
        ? 'Destination pending verification'
        : status !== 'failed'
          ? `Retry unavailable while payout is ${status}`
          : 'Retry unavailable due to policy gate';

  return {
    ...row,
    sellerId,
    destinationAccountId,
    destinationMaskedAccount,
    destinationType,
    destinationVerificationStatus,
    destinationStatus: destinationVerificationStatus,
    destinationActive,
    destinationLastError,
    destinationRecoveredFromFallback: Boolean(destination),
    sellerSuspended,
    verificationBlockers,
    currentState: status,
    attemptCount,
    lastError: failureReason ?? normalizeText(row.latestAttemptFailureReason ?? row.latest_attempt_failure_reason) ?? null,
    holdReason: status === 'held' ? normalizeText(row.holdReason ?? row.hold_reason) ?? null : null,
    retryEligible,
    retryAllowed: retryEligible,
    manualReviewPending: status === 'held',
    retryBlockedReason,
    auditSummary: {
      totalEvents: Number(row.auditEventCount ?? row.audit_event_count ?? 0),
      latestEventType: normalizeText(row.latestAuditEventType ?? row.latest_audit_event_type) ?? null,
      latestEventAt: normalizeText(row.latestAuditEventAt ?? row.latest_audit_event_at) ?? null,
    },
  };
}

export function createPaymentAdminPayoutRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.get('/payouts', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const rawLimit = Array.isArray(req.query?.limit) ? req.query.limit[0] : req.query?.limit;
      const rawOffset = Array.isArray(req.query?.offset) ? req.query.offset[0] : req.query?.offset;
      const parsedLimit = Number(rawLimit);
      const parsedOffset = Number(rawOffset);
      const hasPaginationQuery = rawLimit != null || rawOffset != null;
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(Math.trunc(parsedLimit), 1), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
      const offset = Number.isFinite(parsedOffset) ? Math.max(Math.trunc(parsedOffset), 0) : 0;

      const db = getPaymentDb();
      const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM payouts`).get() as { total?: number } | undefined)?.total ?? 0);
      const rows = db.prepare(
        `SELECT
          p.id,
          p.seller_id AS sellerId,
          p.order_id AS orderId,
          p.escrow_id AS escrowId,
          e.state AS escrowState,
          p.release_entry_id AS releaseEntryId,
          p.amount,
          p.currency,
          p.status,
          p.provider,
          p.provider_charge_id AS providerChargeId,
          p.provider_ref_id AS providerReference,
          p.provider_transaction_id AS providerTransactionId,
          p.provider_status AS providerStatus,
          p.processed_by AS processedBy,
          p.approved_by AS approvedBy,
          p.destination_account_id AS destinationAccountId,
          spa.masked_account AS destinationMaskedAccount,
          spa.destination_type AS destinationType,
          spa.verification_status AS destinationVerificationStatus,
          spa.is_active AS destinationIsActive,
          spa.last_error AS destinationLastError,
          s.is_suspended AS sellerSuspended,
          p.failure_reason AS failureReason,
          p.manual_review_reason AS manualReviewReason,
          p.requested_by AS requestedBy,
          p.requested_at AS requestedAt,
          p.sent_at AS sentAt,
          p.paid_at AS paidAt,
          p.failed_at AS failedAt,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          p.gross_amount AS grossAmount,
          p.platform_fee_amount AS platformFeeAmount,
          p.processing_fee_amount AS legacyProcessingFeeAmount,
          p.reserve_amount AS reserveAmount,
          p.reserve_cap_amount AS reserveCapAmount,
          p.manual_adjustment_amount AS manualAdjustmentAmount,
          p.net_amount AS netAmount,
          p.formula_snapshot AS formulaSnapshot,
          p.last_adjustment_id AS lastAdjustmentId,
          (SELECT COALESCE(MAX(attempt_no), 0) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS attemptCount,
          (SELECT MAX(attempt_no) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS latestAttemptNo,
          (SELECT status FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptStatus,
          (SELECT created_at FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptAt,
          (SELECT failure_reason FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptFailureReason,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventAt,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventAt,
          (SELECT COUNT(*) FROM payout_events pe WHERE pe.payout_id = p.id) AS auditEventCount,
          (SELECT COUNT(*) FROM payout_adjustments pa WHERE pa.payout_id = p.id) AS adjustmentCount,
          (
            SELECT details
            FROM admin_actions aa
            WHERE aa.target_type = ?
              AND aa.target_id = p.seller_id
              AND aa.action_type IN (?, ?)
            ORDER BY aa.created_at DESC, aa.id DESC
            LIMIT 1
          ) AS latestSellerPayoutControlDetails
        FROM payouts p
        LEFT JOIN escrows e ON e.id = p.escrow_id
        LEFT JOIN seller_payout_accounts spa ON spa.id = p.destination_account_id
        LEFT JOIN sellers s ON s.uid = p.seller_id
        ORDER BY p.created_at DESC
        LIMIT ?
        OFFSET ?`,
      ).all('seller', 'suspend_payouts', 'unsuspend_payouts', limit, offset) as Array<Record<string, unknown>>;

      const shapedRows = rows.map((row) => hydratePayoutRow(db, row));

      if (hasPaginationQuery) {
        return res.status(200).json({
          rows: shapedRows,
          pagination: {
            limit,
            offset,
            total,
            hasMore: offset + shapedRows.length < total,
          },
        });
      }

      return res.status(200).json(shapedRows);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load payout queue' });
    }
  });

  router.get('/payouts/detail/:payoutId', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const payoutId = String(req.params.payoutId ?? '').trim();
      if (!payoutId) {
        return res.status(400).json({ error: 'payoutId is required' });
      }

      const db = getPaymentDb();
      const row = db.prepare(
        `SELECT
          p.id,
          p.seller_id AS sellerId,
          p.order_id AS orderId,
          p.escrow_id AS escrowId,
          e.state AS escrowState,
          p.release_entry_id AS releaseEntryId,
          p.amount,
          p.currency,
          p.status,
          p.provider,
          p.provider_charge_id AS providerChargeId,
          p.provider_ref_id AS providerReference,
          p.provider_transaction_id AS providerTransactionId,
          p.provider_status AS providerStatus,
          p.processed_by AS processedBy,
          p.approved_by AS approvedBy,
          p.destination_account_id AS destinationAccountId,
          spa.masked_account AS destinationMaskedAccount,
          spa.destination_type AS destinationType,
          spa.verification_status AS destinationVerificationStatus,
          spa.is_active AS destinationIsActive,
          spa.last_error AS destinationLastError,
          s.is_suspended AS sellerSuspended,
          p.failure_reason AS failureReason,
          p.manual_review_reason AS manualReviewReason,
          p.requested_by AS requestedBy,
          p.requested_at AS requestedAt,
          p.sent_at AS sentAt,
          p.paid_at AS paidAt,
          p.failed_at AS failedAt,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          p.gross_amount AS grossAmount,
          p.platform_fee_amount AS platformFeeAmount,
          p.processing_fee_amount AS legacyProcessingFeeAmount,
          p.reserve_amount AS reserveAmount,
          p.reserve_cap_amount AS reserveCapAmount,
          p.manual_adjustment_amount AS manualAdjustmentAmount,
          p.net_amount AS netAmount,
          p.formula_snapshot AS formulaSnapshot,
          p.last_adjustment_id AS lastAdjustmentId,
          (SELECT COALESCE(MAX(attempt_no), 0) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS attemptCount,
          (SELECT MAX(attempt_no) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS latestAttemptNo,
          (SELECT status FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptStatus,
          (SELECT created_at FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptAt,
          (SELECT failure_reason FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptFailureReason,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventAt,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventAt,
          (SELECT COUNT(*) FROM payout_events pe WHERE pe.payout_id = p.id) AS auditEventCount,
          (SELECT COUNT(*) FROM payout_adjustments pa WHERE pa.payout_id = p.id) AS adjustmentCount,
          (
            SELECT details
            FROM admin_actions aa
            WHERE aa.target_type = ?
              AND aa.target_id = p.seller_id
              AND aa.action_type IN (?, ?)
            ORDER BY aa.created_at DESC, aa.id DESC
            LIMIT 1
          ) AS latestSellerPayoutControlDetails
        FROM payouts p
        LEFT JOIN escrows e ON e.id = p.escrow_id
        LEFT JOIN seller_payout_accounts spa ON spa.id = p.destination_account_id
        LEFT JOIN sellers s ON s.uid = p.seller_id
        WHERE p.id = ?
        LIMIT 1`,
      ).get('seller', 'suspend_payouts', 'unsuspend_payouts', payoutId) as Record<string, unknown> | undefined;

      if (!row) {
        return res.status(404).json({ error: 'Payout not found' });
      }

      return res.status(200).json(hydratePayoutRow(db, row));
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load payout detail' });
    }
  });

  return router;
}