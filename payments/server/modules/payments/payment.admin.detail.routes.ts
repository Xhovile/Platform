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

function hydratePayoutDetailRow(db: ReturnType<typeof getPaymentDb>, row: Record<string, unknown>) {
  const payoutId = String(row.id ?? '').trim();
  const sellerId = normalizeText(row.sellerId ?? row.seller_id) 
    ?? normalizeText(row.orderSellerId ?? row.order_seller_id)
    ?? normalizeText(row.firstEventSellerId ?? row.first_event_seller_id)
    ?? normalizeText(row.latestEventSellerId ?? row.latest_event_seller_id)
    ?? '';

  const orderId = normalizeText(row.orderId ?? row.order_id ?? row.joinedOrderId ?? row.joined_order_id) ?? null;
  const escrowId = normalizeText(row.escrowId ?? row.escrow_id ?? row.joinedEscrowId ?? row.joined_escrow_id) ?? null;

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

  const providerStatus = normalizeText(row.providerStatus ?? row.provider_status)
    ?? normalizeText(row.latestAttemptStatus ?? row.latest_attempt_status)
    ?? normalizeText(row.status)
    ?? null;
  const providerReference = normalizeText(row.providerReference ?? row.provider_ref_id)
    ?? normalizeText(row.latestAttemptProviderReference ?? row.latest_attempt_provider_reference)
    ?? null;
  const providerTransactionId = normalizeText(row.providerTransactionId ?? row.provider_transaction_id)
    ?? normalizeText(row.latestAttemptProviderTransactionId ?? row.latest_attempt_provider_transaction_id)
    ?? null;

  const latestWebhookEventType = normalizeText(row.latestWebhookEventType ?? row.latest_webhook_event_type) ?? null;
  const latestWebhookEventAt = normalizeText(row.latestWebhookEventAt ?? row.latest_webhook_event_at) ?? null;
  const latestAttemptStatus = normalizeText(row.latestAttemptStatus ?? row.latest_attempt_status) ?? null;
  const latestAttemptAt = normalizeText(row.latestAttemptAt ?? row.latest_attempt_at) ?? null;
  const latestAttemptFailureReason = normalizeText(row.latestAttemptFailureReason ?? row.latest_attempt_failure_reason) ?? null;
  const failureReason = normalizeText(row.failureReason ?? row.failure_reason) ?? null;
  const manualReviewReason = normalizeText(row.manualReviewReason ?? row.manual_review_reason) ?? null;
  const holdReason = normalizeText(row.holdReason ?? row.hold_reason) ?? null;
  const requestedBy = normalizeText(row.requestedBy ?? row.requested_by)
    ?? normalizeText(row.firstEventActorId ?? row.first_event_actor_id)
    ?? null;
  const requestedAt = normalizeText(row.requestedAt ?? row.requested_at) ?? null;

  const currentStatus = String(row.currentState ?? row.status ?? '').toLowerCase();
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
    currentStatus === 'held'
      ? !failureReason || isRetryableFailureCode(failureReason)
      : isRetryableFailureCode(failureReason);

  const retryEligible =
    (currentStatus === 'failed' || currentStatus === 'held') &&
    attemptCount < PAYOUT_POLICY.maxRetryCount &&
    hasRetryableFailureContext &&
    !sellerSuspended &&
    destinationVerificationStatus === 'verified' &&
    destinationActive;

  return {
    ...row,
    sellerId,
    orderId,
    escrowId,
    destinationAccountId,
    destinationMaskedAccount,
    destinationType,
    destinationVerificationStatus,
    destinationActive,
    destinationLastError,
    providerStatus,
    providerReference,
    providerTransactionId,
    latestWebhookEventType,
    latestWebhookEventAt,
    latestAttemptStatus,
    latestAttemptAt,
    latestAttemptFailureReason,
    requestedBy,
    requestedAt,
    failureReason,
    manualReviewReason,
    holdReason,
    sellerSuspended,
    verificationBlockers,
    retryEligible,
    retryBlockedReason: retryEligible
      ? null
      : sellerSuspended
        ? 'Seller payouts are suspended'
        : destinationVerificationStatus !== 'verified' || !destinationActive
          ? 'Destination pending verification'
          : currentStatus !== 'failed'
            ? `Retry unavailable while payout is ${currentStatus}`
            : 'Retry unavailable due to policy gate',
    destinationRecoveredFromFallback: Boolean(destination),
    payoutId,
  };
}

export function createPaymentAdminDetailRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

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
           o.seller_id AS orderSellerId,
           o.escrow_id AS orderEscrowId,
           e.state AS escrowState,
           s.is_suspended AS sellerSuspended,
           (SELECT seller_id FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at ASC, pe.id ASC LIMIT 1) AS firstEventSellerId,
           (SELECT actor_id FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at ASC, pe.id ASC LIMIT 1) AS firstEventActorId,
           (SELECT actor_type FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at ASC, pe.id ASC LIMIT 1) AS firstEventActorType,
           (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC, pe.id DESC LIMIT 1) AS latestAuditEventType,
           (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id ORDER BY pe.created_at DESC, pe.id DESC LIMIT 1) AS latestAuditEventAt,
           (SELECT event_type FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC, pe.id DESC LIMIT 1) AS latestWebhookEventType,
           (SELECT created_at FROM payout_events pe WHERE pe.payout_id = p.id AND pe.event_type IN ('payout_reconciled', 'payout_webhook_duplicate', 'payout_webhook_rejected') ORDER BY pe.created_at DESC, pe.id DESC LIMIT 1) AS latestWebhookEventAt,
           (SELECT COUNT(*) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS attemptCount,
           (SELECT MAX(attempt_no) FROM payout_attempts pa WHERE pa.payout_id = p.id) AS latestAttemptNo,
           (SELECT status FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC, pa.created_at DESC LIMIT 1) AS latestAttemptStatus,
           (SELECT created_at FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC, pa.created_at DESC LIMIT 1) AS latestAttemptAt,
           (SELECT failure_reason FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC, pa.created_at DESC LIMIT 1) AS latestAttemptFailureReason,
           (SELECT provider_reference FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC, pa.created_at DESC LIMIT 1) AS latestAttemptProviderReference,
           (SELECT provider_transaction_id FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC, pa.created_at DESC LIMIT 1) AS latestAttemptProviderTransactionId,
           (SELECT provider_charge_id FROM payout_attempts pa WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC, pa.created_at DESC LIMIT 1) AS latestAttemptProviderChargeId
         FROM payouts p
         LEFT JOIN orders o ON o.id = p.order_id OR o.id = (SELECT escrow_id FROM escrows WHERE id = p.escrow_id LIMIT 1)
         LEFT JOIN escrows e ON e.id = p.escrow_id
         LEFT JOIN sellers s ON s.uid = COALESCE(p.seller_id, o.seller_id)
         WHERE p.id = ?
         LIMIT 1`,
      ).get(payoutId) as Record<string, unknown> | undefined;

      if (!row) {
        return res.status(404).json({ error: 'Payout not found' });
      }

      const payout = hydratePayoutDetailRow(db, row);
      return res.status(200).json({
        success: true,
        payout,
        ...payout,
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load payout detail' });
    }
  });

  return router;
}
