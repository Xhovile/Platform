import express, { type RequestHandler } from 'express';
import { hasAdminAccess } from '../../auth/adminAccess.js';
import { getPaymentDb } from '../../postgresCompat.js';
import { payoutLimiter } from '../../routes/escrow/shared.js';
import { PAYOUT_POLICY, isRetryableFailureCode } from '../payouts/payout.policy.js';

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

function parseJson(value: unknown): unknown {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildDiagnostics(row: Record<string, unknown>) {
  return {
    payoutId: normalizeText(row.id) ?? null,
    sellerId: normalizeText(row.sellerId ?? row.seller_id) ?? null,
    orderId: normalizeText(row.orderId ?? row.order_id) ?? null,
    escrowId: normalizeText(row.escrowId ?? row.escrow_id) ?? null,
    status: normalizeText(row.status) ?? null,
    provider: normalizeText(row.provider) ?? null,
    providerStatus: normalizeText(row.providerStatus ?? row.provider_status) ?? null,
    providerChargeId: normalizeText(row.providerChargeId ?? row.provider_charge_id) ?? null,
    providerReference: normalizeText(row.providerReference ?? row.provider_ref_id) ?? null,
    providerTransactionId: normalizeText(row.providerTransactionId ?? row.provider_transaction_id) ?? null,
    destinationAccountId: normalizeText(row.destinationAccountId ?? row.destination_account_id) ?? null,
    destinationVerificationStatus: normalizeText(row.destinationVerificationStatus ?? row.destination_verification_status) ?? null,
    destinationActive: row.destinationActive === null || row.destinationActive === undefined ? null : Boolean(row.destinationActive),
    destinationLastError: normalizeText(row.destinationLastError ?? row.destination_last_error) ?? null,
    sellerSuspended: Boolean(row.sellerSuspended ?? row.seller_suspended),
    failureReason: normalizeText(row.failureReason ?? row.failure_reason) ?? null,
    manualReviewReason: normalizeText(row.manualReviewReason ?? row.manual_review_reason) ?? null,
    latestAttemptNo: row.latestAttemptNo == null ? null : Number(row.latestAttemptNo),
    latestAttemptStatus: normalizeText(row.latestAttemptStatus ?? row.latest_attempt_status) ?? null,
    latestAttemptFailureReason: normalizeText(row.latestAttemptFailureReason ?? row.latest_attempt_failure_reason) ?? null,
    latestAttemptAt: normalizeText(row.latestAttemptAt ?? row.latest_attempt_at) ?? null,
    latestAttemptProviderChargeId: normalizeText(row.latestAttemptProviderChargeId ?? row.latest_attempt_provider_charge_id) ?? null,
    latestAttemptProviderResponse: parseJson(row.latestAttemptProviderResponse ?? row.latest_attempt_provider_response),
    latestWebhookEventType: normalizeText(row.latestWebhookEventType ?? row.latest_webhook_event_type) ?? null,
    latestWebhookEventAt: normalizeText(row.latestWebhookEventAt ?? row.latest_webhook_event_at) ?? null,
    latestAuditEventType: normalizeText(row.latestAuditEventType ?? row.latest_audit_event_type) ?? null,
    latestAuditEventAt: normalizeText(row.latestAuditEventAt ?? row.latest_audit_event_at) ?? null,
    retryEligible: row.retryEligible === null || row.retryEligible === undefined ? null : Boolean(row.retryEligible),
    retryBlockedReason: normalizeText(row.retryBlockedReason ?? row.retry_blocked_reason) ?? null,
  };
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
    normalizeText(row.firstEventSellerId ?? row.first_event_seller_id) ??
    normalizeText(row.latestEventSellerId ?? row.latest_event_seller_id) ??
    '';
  const currentDestinationAccountId = normalizeText(row.destinationAccountId ?? row.destination_account_id) ?? null;
  const currentDestinationStatus = String(row.destinationVerificationStatus ?? row.destination_verification_status ?? 'missing').toLowerCase();
  const currentDestinationActive = Number(row.destinationActive ?? row.destination_active ?? row.destinationIsActive ?? row.destination_is_active ?? 0) === 1;
  const fallbackDestination = sellerId ? findDefaultVerifiedDestination(db, sellerId) : undefined;

  const currentDestinationIsUsable =
    !!currentDestinationAccountId &&
    currentDestinationStatus === 'verified' &&
    currentDestinationActive;

  const destination = !currentDestinationIsUsable && fallbackDestination ? fallbackDestination : undefined;

  return {
    ...row,
    sellerId,
    sellerBusinessName: normalizeText(row.sellerBusinessName ?? row.seller_business_name) ?? normalizeText(row.sellerEmail ?? row.seller_email) ?? (sellerId || null),
    provider: normalizeText(row.provider) ?? normalizeText(row.destinationProviderName ?? row.destination_provider_name) ?? 'paychangu',
    destinationAccountId: destination?.id ?? currentDestinationAccountId,
    destinationMaskedAccount: destination?.maskedAccount ?? normalizeText(row.destinationMaskedAccount ?? row.destination_masked_account) ?? null,
    destinationType: destination?.destinationType ?? normalizeText(row.destinationType ?? row.destination_type) ?? null,
    destinationVerificationStatus: (destination?.verificationStatus ?? normalizeText(row.destinationVerificationStatus ?? row.destination_verification_status) ?? 'missing').toLowerCase(),
    destinationActive: destination ? Number(destination.isActive ?? 1) === 1 : currentDestinationActive,
    destinationLastError: destination?.lastError ?? normalizeText(row.destinationLastError ?? row.destination_last_error) ?? null,
    destinationRecoveredFromFallback: Boolean(destination),
  };
}

function shapeRow(row: Record<string, unknown>) {
  const sellerId = normalizeText(row.sellerId ?? row.seller_id) ?? '';
  const sellerBusinessName = normalizeText(row.sellerBusinessName ?? row.seller_business_name) ?? normalizeText(row.sellerEmail ?? row.seller_email) ?? (sellerId || null);
  const status = String(row.currentState ?? row.status ?? '').toLowerCase();
  const failureReason = normalizeText(row.failureReason ?? row.failure_reason) ?? null;
  const destinationVerificationStatus = String(row.destinationVerificationStatus ?? row.destination_verification_status ?? 'missing').toLowerCase();
  const destinationActive = Number(row.destinationActive ?? row.destination_active ?? row.destinationIsActive ?? row.destination_is_active ?? 0) === 1;
  const sellerSuspended = Number(row.sellerSuspended ?? row.seller_suspended ?? 0) === 1;
  const attemptCount = Number(row.attemptCount ?? row.attempt_count ?? 0);

  const verificationBlockers: string[] = [];
  if (sellerSuspended) verificationBlockers.push('Seller payouts are suspended');
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
    sellerBusinessName,
    provider: normalizeText(row.provider) ?? normalizeText(row.destinationProviderName ?? row.destination_provider_name) ?? 'paychangu',
    currentState: status,
    attemptCount,
    destinationVerificationStatus,
    destinationActive,
    sellerSuspended,
    verificationBlockers,
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
    diagnostics: buildDiagnostics({ ...row, retryEligible, retryBlockedReason }),
  };
}

export function createPaymentAdminPayoutDisplayRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.get('/payouts', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const rawLimit = Array.isArray(req.query?.limit) ? req.query.limit[0] : req.query?.limit;
      const rawOffset = Array.isArray(req.query?.offset) ? req.query.offset[0] : req.query?.offset;
      const parsedLimit = Number(rawLimit);
      const parsedOffset = Number(rawOffset);
      const hasPaginationQuery = rawLimit != null || rawOffset != null;
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 500) : 200;
      const offset = Number.isFinite(parsedOffset) ? Math.max(Math.trunc(parsedOffset), 0) : 0;

      const db = getPaymentDb();
      const total = Number((db.prepare(`SELECT COUNT(*) AS total FROM payouts`).get() as { total?: number } | undefined)?.total ?? 0);
      const rows = db.prepare(
        `SELECT
          p.id,
          p.seller_id AS sellerId,
          s.business_name AS sellerBusinessName,
          s.email AS sellerEmail,
          o.seller_id AS orderSellerId,
          p.order_id AS orderId,
          p.escrow_id AS escrowId,
          e.state AS escrowState,
          p.release_entry_id AS releaseEntryId,
          p.amount,
          p.currency,
          p.status,
          p.provider,
          spa.provider_name AS destinationProviderName,
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
          (SELECT provider_charge_id FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptProviderChargeId,
          (SELECT response_payload FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptProviderResponse,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventAt,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventAt,
          (SELECT COUNT(*) FROM payout_events pe WHERE pe.payout_id = p.id) AS auditEventCount,
          (SELECT COUNT(*) FROM payout_adjustments pa WHERE pa.payout_id = p.id) AS adjustmentCount
         FROM payouts p
         LEFT JOIN orders o ON o.id = p.order_id
         LEFT JOIN sellers s ON s.uid = COALESCE(NULLIF(p.seller_id, ''), o.seller_id)
         LEFT JOIN escrows e ON e.id = p.escrow_id
         LEFT JOIN seller_payout_accounts spa ON spa.id = p.destination_account_id
         ORDER BY p.created_at DESC
         LIMIT ?
         OFFSET ?`,
      ).all(limit, offset) as Array<Record<string, unknown>>;

      const shapedRows = rows.map((row) => shapeRow(hydratePayoutRow(db, row)));

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
          s.business_name AS sellerBusinessName,
          s.email AS sellerEmail,
          o.seller_id AS orderSellerId,
          p.order_id AS orderId,
          p.escrow_id AS escrowId,
          e.state AS escrowState,
          p.release_entry_id AS releaseEntryId,
          p.amount,
          p.currency,
          p.status,
          p.provider,
          spa.provider_name AS destinationProviderName,
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
          (SELECT provider_charge_id FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptProviderChargeId,
          (SELECT response_payload FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1) AS latestAttemptProviderResponse,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC LIMIT 1) AS latestWebhookEventAt,
          (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventType,
          (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC LIMIT 1) AS latestAuditEventAt,
          (SELECT COUNT(*) FROM payout_events pe WHERE pe.payout_id = p.id) AS auditEventCount,
          (SELECT COUNT(*) FROM payout_adjustments pa WHERE pa.payout_id = p.id) AS adjustmentCount
         FROM payouts p
         LEFT JOIN orders o ON o.id = p.order_id
         LEFT JOIN sellers s ON s.uid = COALESCE(NULLIF(p.seller_id, ''), o.seller_id)
         LEFT JOIN escrows e ON e.id = p.escrow_id
         LEFT JOIN seller_payout_accounts spa ON spa.id = p.destination_account_id
         WHERE p.id = ?
         LIMIT 1`,
      ).get(payoutId) as Record<string, unknown> | undefined;

      if (!row) {
        return res.status(404).json({ error: 'Payout not found' });
      }

      return res.status(200).json(shapeRow(hydratePayoutRow(db, row)));
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load payout detail' });
    }
  });

  return router;
}
