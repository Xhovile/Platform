import express, { type RequestHandler } from 'express';
import { hasAdminAccess } from '../../auth/adminAccess.js';
import { getPaymentDb } from '../../postgresCompat.js';
import { payoutService } from '../payouts/payout.service.js';
import { PAYOUT_POLICY, calculatePayoutFormula, isRetryableFailureCode } from '../payouts/payout.policy.js';
import { payoutLimiter } from '../../routes/escrow/shared.js';
import { ADMIN_ACTION_TYPES, ADMIN_TARGET_TYPES } from '../../../src/modules/admin/shared/adminAuditTypes.js';
import { getPayChanguPayoutBalance } from '../payouts/paychangu.payout.js';

const DEFAULT_PAYOUT_PAGE_SIZE = 200;
const MAX_PAYOUT_PAGE_SIZE = 500;

function jsonError(error: unknown, fallback: string): { error: string } {
  return {
    error: error instanceof Error ? error.message : fallback,
  };
}

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

function normalizeAmount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('amount must be a non-negative number');
  }
  return Math.round(parsed);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error('suspended must be a boolean');
}

function normalizeVerificationStatus(value: unknown): 'pending' | 'verified' | 'failed' | 'disabled' {
  const status = normalizeText(value)?.toLowerCase();
  if (status === 'pending' || status === 'verified' || status === 'failed' || status === 'disabled') {
    return status;
  }
  throw new Error('status must be one of: pending, verified, failed, disabled');
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

function getGrossAmount(row: Record<string, unknown>): number {
  const fromColumn = Number(row.gross_amount ?? 0);
  if (Number.isFinite(fromColumn) && fromColumn > 0) {
    return Math.round(fromColumn);
  }

  const snapshot = parseJsonObject((row.raw_request as string | null | undefined) ?? null);
  const payoutFormula = snapshot?.payoutFormula && typeof snapshot.payoutFormula === 'object' ? snapshot.payoutFormula as Record<string, unknown> : null;
  const grossFromSnapshot = Number(payoutFormula?.grossAmount ?? snapshot?.releaseAmount ?? row.amount ?? 0);
  if (Number.isFinite(grossFromSnapshot) && grossFromSnapshot > 0) {
    return Math.round(grossFromSnapshot);
  }

  return Math.round(Number(row.amount ?? 0));
}

function getCurrentFormulaSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  const existingSnapshot = parseJsonObject((row.formula_snapshot as string | null | undefined) ?? null);
  if (existingSnapshot) {
    return existingSnapshot;
  }

  const rawRequest = parseJsonObject((row.raw_request as string | null | undefined) ?? null);
  const payoutFormula = rawRequest?.payoutFormula && typeof rawRequest.payoutFormula === 'object'
    ? rawRequest.payoutFormula as Record<string, unknown>
    : null;

  return payoutFormula ?? {};
}

function insertPayoutAdjustment(params: {
  payoutId: string;
  sellerId: string;
  adjustmentType: string;
  amount: number;
  currency: string;
  reason: string;
  actorType: 'admin';
  actorId: string | null;
  providerReference?: string | null;
}): number {
  const db = getPaymentDb();
  const result = db.prepare(
    `INSERT INTO payout_adjustments (
      payout_id,
      seller_id,
      adjustment_type,
      amount,
      currency,
      reason,
      actor_type,
      actor_id,
      provider_reference,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.payoutId,
    params.sellerId,
    params.adjustmentType,
    params.amount,
    params.currency,
    params.reason,
    params.actorType,
    params.actorId,
    params.providerReference ?? null,
    new Date().toISOString(),
  );
  return Number(result.lastInsertRowid);
}

function recalculatePayoutFinancials(row: Record<string, unknown>, next: {
  manualAdjustmentAmount?: number;
  reserveAmount?: number;
}): ReturnType<typeof calculatePayoutFormula> {
  const grossAmount = getGrossAmount(row);
  const currentSnapshot = getCurrentFormulaSnapshot(row);
  const manualAdjustmentAmount = normalizeAmount(next.manualAdjustmentAmount ?? row.manual_adjustment_amount ?? currentSnapshot.manualAdjustmentAmount ?? 0);
  const reserveAmount = normalizeAmount(next.reserveAmount ?? row.reserve_amount ?? currentSnapshot.reserveAmount ?? 0);

  return calculatePayoutFormula({
    grossAmount,
    reserveAmount,
    manualAdjustmentAmount,
    currency: String(row.currency ?? 'MWK'),
  });
}

function addSellerPayoutAccountEvent(input: {
  sellerId: string;
  accountId: string;
  eventType: string;
  actorId: string | null;
  note?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  getPaymentDb().prepare(
    `INSERT INTO seller_payout_account_events (
      seller_uid,
      account_id,
      event_type,
      actor_type,
      actor_id,
      note,
      payload,
      created_at
    ) VALUES (?, ?, ?, 'admin', ?, ?, ?, ?)`,
  ).run(
    input.sellerId,
    input.accountId,
    input.eventType,
    input.actorId,
    input.note ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
    new Date().toISOString(),
  );
}

export function createPaymentAdminRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.get('/payments', requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const db = getPaymentDb();
      const rows = db.prepare(`
        SELECT
          p.id,
          p.order_id,
          p.provider,
          p.method,
          p.status AS payment_status,
          p.reference,
          p.provider_reference,
          p.currency,
          p.amount,
          p.checkout_url,
          p.paid_at,
          p.verified,
          p.verification,
          p.created_at,
          p.updated_at,
          o.status AS order_status,
          o.paid_at AS order_paid_at,
          o.fulfilled_at AS order_fulfilled_at,
          o.escrow_id,
          e.state AS escrow_state,
          e.balance_amount,
          e.balance_currency,
          e.updated_at AS escrow_updated_at
        FROM payments p
        LEFT JOIN orders o ON o.payment_reference = p.reference
        LEFT JOIN escrows e ON e.order_id = o.id
        ORDER BY p.created_at DESC
        LIMIT 200
      `).all();

      return res.status(200).json(rows);
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to load payments'));
    }
  });

  router.get('/webhook-events', requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const db = getPaymentDb();
      const rows = db.prepare(`
        SELECT id, provider, reference, event_type, signature_valid, payload, created_at
        FROM payment_webhook_events
        ORDER BY created_at DESC
        LIMIT 200
      `).all();

      return res.status(200).json(rows);
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to load webhook events'));
    }
  });

  router.get('/payment-summary', requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const db = getPaymentDb();
      const summary = db.prepare(`
        SELECT
          COUNT(*) AS total_payments,
          SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified_payments,
          SUM(CASE WHEN status IN ('captured', 'paid') THEN 1 ELSE 0 END) AS paid_payments,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_payments
        FROM payments
      `).get();

      const webhookSummary = db.prepare(`
        SELECT
          COUNT(*) AS total_webhooks,
          SUM(CASE WHEN signature_valid = 1 THEN 1 ELSE 0 END) AS valid_webhooks,
          SUM(CASE WHEN signature_valid = 0 THEN 1 ELSE 0 END) AS invalid_webhooks
        FROM payment_webhook_events
      `).get();

      return res.status(200).json({ summary, webhookSummary });
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to load payment summary'));
    }
  });

  router.get('/paychangu/balance', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rawCurrency = Array.isArray(req.query?.currency) ? req.query.currency[0] : req.query?.currency;
    const currency = String(rawCurrency ?? 'MWK').trim().toUpperCase() || 'MWK';

    console.log("ADMIN BALANCE ROUTE HIT", { currency });
    const result = await getPayChanguPayoutBalance(currency);
    const raw = result.rawResponse as Record<string, unknown>;
    const data = (raw?.data as Record<string, unknown> | undefined) ?? raw;

    const mainBalance = Number(
      data.main_balance ??
        data.available_balance ??
        data.balance ??
        result.availableBalance ??
        0,
    );
    const collectionBalance = Number(data.collection_balance ?? 0);

    return res.status(200).json({
      provider: 'paychangu',
      environment: String(data.environment ?? 'live'),
      currency: result.currency ?? currency,
      mainBalance,
      collectionBalance,
      availableBalance: mainBalance,
      checkedAt: result.checkedAt,
      rawResponse: raw,
    });
  } catch (error) {
    return res.status(500).json(jsonError(error, 'Failed to load PayChangu balance'));
  }
});
  
  router.get('/payouts', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const rawLimit = Array.isArray(req.query?.limit) ? req.query.limit[0] : req.query?.limit;
      const rawOffset = Array.isArray(req.query?.offset) ? req.query.offset[0] : req.query?.offset;
      const parsedLimit = Number(rawLimit);
      const parsedOffset = Number(rawOffset);
      const hasPaginationQuery = rawLimit != null || rawOffset != null;
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(Math.trunc(parsedLimit), 1), MAX_PAYOUT_PAGE_SIZE)
        : DEFAULT_PAYOUT_PAGE_SIZE;
      const offset = Number.isFinite(parsedOffset) ? Math.max(Math.trunc(parsedOffset), 0) : 0;

      const db = getPaymentDb();
      const total = Number(
        (db
          .prepare(`
            SELECT COUNT(*) AS total
            FROM payouts
          `)
          .get() as { total?: number } | undefined)?.total ?? 0,
      );
      const rows = db.prepare(`
        SELECT
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
         OFFSET ?
      `).all(ADMIN_TARGET_TYPES.SELLER, ADMIN_ACTION_TYPES.SUSPEND_PAYOUTS, ADMIN_ACTION_TYPES.UNSUSPEND_PAYOUTS, limit, offset);
      const shapedRows = (rows as Array<Record<string, unknown>>).map((row) => {
        const status = String(row.status ?? '').toLowerCase();
        const failureReason = (row.failureReason as string | null) ?? null;
        const attemptCount = Number(row.attemptCount ?? 0);
        const destinationVerificationStatus = String(row.destinationVerificationStatus ?? 'missing').toLowerCase();
        const destinationActive = Number(row.destinationIsActive ?? 0) === 1;
        const sellerSuspended = Number(row.sellerSuspended ?? 0) === 1;
        const verificationBlockers = [];
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
        const holdReason = status === 'held' ? (row.manualReviewReason as string | null) ?? null : null;
        const auditSummary = {
          totalEvents: Number(row.auditEventCount ?? 0),
          latestEventType: (row.latestAuditEventType as string | null) ?? null,
          latestEventAt: (row.latestAuditEventAt as string | null) ?? null,
        };
        return {
          ...row,
          currentState: status,
          attemptCount,
          destinationVerificationStatus,
          destinationActive,
          sellerSuspended,
          verificationBlockers,
          lastError: failureReason ?? (row.latestAttemptFailureReason as string | null) ?? null,
          holdReason,
          retryEligible,
          retryBlockedReason: retryEligible
            ? null
            : destinationVerificationStatus !== 'verified' || !destinationActive
              ? 'Destination pending verification'
              : status !== 'failed'
                ? `Retry unavailable while payout is ${status}`
                : 'Retry unavailable due to policy gate',
          auditSummary,
        };
      });

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
      return res.status(500).json(jsonError(error, 'Failed to load payout queue'));
    }
  });

  router.post('/payouts/destinations/:destinationId/verification', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const destinationId = String(req.params.destinationId || '').trim();
      if (!destinationId) {
        return res.status(400).json({ error: 'destinationId is required' });
      }

      const status = normalizeVerificationStatus(req.body?.status);
      const reason = normalizeText(req.body?.reason);
      const actorId = String(req.user?.uid || 'admin').trim();
      const now = new Date().toISOString();
      const db = getPaymentDb();
      const destination = db.prepare(
        `SELECT id, seller_uid, verification_status, is_active
         FROM seller_payout_accounts
         WHERE id = ?
         LIMIT 1`,
      ).get(destinationId) as { id: string; seller_uid: string; verification_status: string; is_active: number } | undefined;

      if (!destination) {
        return res.status(404).json({ error: 'Payout destination not found' });
      }

      const nextActive = status === 'disabled' ? 0 : 1;
      const nextVerifiedAt = status === 'verified' ? now : null;
      const nextLastError = status === 'failed' || status === 'disabled' ? reason : null;
      const nextAttempts = Number(
        (db.prepare(`SELECT verification_attempts FROM seller_payout_accounts WHERE id = ?`).get(destinationId) as { verification_attempts?: number } | undefined)?.verification_attempts ?? 0,
      ) + 1;

      db.transaction(() => {
        db.prepare(
          `UPDATE seller_payout_accounts
           SET verification_status = ?,
               is_active = ?,
               verification_attempts = ?,
               last_error = ?,
               verified_at = ?,
               updated_at = ?
           WHERE id = ?`,
        ).run(
          status,
          nextActive,
          nextAttempts,
          nextLastError,
          nextVerifiedAt,
          now,
          destinationId,
        );

        addSellerPayoutAccountEvent({
          sellerId: destination.seller_uid,
          accountId: destinationId,
          eventType: `destination_${status}`,
          actorId,
          note: reason,
          payload: {
            previousStatus: destination.verification_status,
            nextStatus: status,
            attempt: nextAttempts,
            active: nextActive === 1,
          },
        });

 if (status === 'verified') {
  db.prepare(
    `INSERT INTO admin_actions (
      admin_uid,
      admin_email,
      action_type,
      target_type,
      target_id,
      details,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    actorId,
    req.user?.email ?? null,
    ADMIN_ACTION_TYPES.APPROVE_PAYOUT_DESTINATION,
    ADMIN_TARGET_TYPES.PAYOUT_DESTINATION,
    destinationId,
    JSON.stringify({
      sellerId: destination.seller_uid,
      previousStatus: destination.verification_status,
      nextStatus: status,
      verificationAttempts: nextAttempts,
      reason,
    }),
    now,
  );
}
      })();

      const updated = db.prepare(
        `SELECT
           id,
           seller_uid AS sellerId,
           verification_status AS verificationStatus,
           verification_attempts AS verificationAttempts,
           last_error AS lastError,
           verified_at AS verifiedAt,
           is_active AS isActive,
           updated_at AS updatedAt
         FROM seller_payout_accounts
         WHERE id = ?
         LIMIT 1`,
      ).get(destinationId);

      return res.status(200).json({ destination: updated });
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to update payout destination verification'));
    }
  });

  router.post('/payouts/sellers/:sellerId/suspension', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const sellerId = String(req.params.sellerId || '').trim();
      if (!sellerId) {
        return res.status(400).json({ error: 'sellerId is required' });
      }

      const suspended = normalizeBoolean(req.body?.suspended);
      const reason = normalizeText(req.body?.reason);
      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      const actorId = String(req.user?.uid || 'admin').trim();
      const db = getPaymentDb();
      const seller = db.prepare(
        `SELECT uid, is_suspended AS isSuspended
         FROM sellers
         WHERE uid = ?
         LIMIT 1`,
      ).get(sellerId) as { uid: string; isSuspended: number } | undefined;

      if (!seller) {
        return res.status(404).json({ error: 'Seller not found' });
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE sellers SET is_suspended = ? WHERE uid = ?`).run(suspended ? 1 : 0, sellerId);

      if (suspended) {
        db.prepare(
          `UPDATE payouts
           SET status = 'held',
               failure_reason = 'seller_suspended',
               manual_review_reason = ?,
               updated_at = ?
           WHERE seller_id = ?
             AND status IN ('eligible', 'queued', 'processing', 'pending', 'failed')`,
        ).run(reason, now, sellerId);
      }

      db.prepare(
        `INSERT INTO admin_actions (admin_uid, admin_email, action_type, target_type, target_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        actorId,
        req.user?.email ?? null,
        suspended ? ADMIN_ACTION_TYPES.SUSPEND_PAYOUTS : ADMIN_ACTION_TYPES.UNSUSPEND_PAYOUTS,
        ADMIN_TARGET_TYPES.SELLER,
        sellerId,
        JSON.stringify({ reason }),
        now,
      );

      return res.status(200).json({ sellerId, suspended, reason });
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to update seller payout suspension'));
    }
  });

  router.get('/payouts/summary', requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const db = getPaymentDb();
      const summary = db.prepare(
        `SELECT
           COUNT(*) AS totalPayouts,
           SUM(CASE WHEN status IN ('eligible', 'queued', 'processing', 'pending', 'held') THEN 1 ELSE 0 END) AS pendingPayouts,
           SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paidPayouts,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedPayouts,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledPayouts
         FROM payouts`,
      ).get();
      const attempts = db.prepare(
        `SELECT
           COUNT(*) AS totalAttempts,
           SUM(CASE WHEN status IN ('paid', 'successful') THEN 1 ELSE 0 END) AS successfulAttempts,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedAttempts
         FROM payout_attempts`,
      ).get();
      return res.status(200).json({ summary, attempts });
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to load payout summary'));
    }
  });

  router.post('/payouts/:payoutId/reconcile', payoutLimiter, requireAuth, async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const result = await payoutService.reconcilePayoutStatus({
        payoutId: String(req.params.payoutId),
        actorType: 'admin',
        actorId: String(req.user?.uid || 'admin'),
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to reconcile payout'));
    }
  });

  router.post('/payouts/:payoutId/rebind-destination', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const payoutId = String(req.params.payoutId || '').trim();
      if (!payoutId) {
        return res.status(400).json({ error: 'payoutId is required' });
      }

      const db = getPaymentDb();
      const payout = db.prepare(
        `SELECT id, seller_id AS sellerId, status, destination_account_id AS destinationAccountId
         FROM payouts
         WHERE id = ?
         LIMIT 1`,
      ).get(payoutId) as { id: string; sellerId: string; status: string; destinationAccountId: string | null } | undefined;

      if (!payout) {
        return res.status(404).json({ error: 'Payout not found' });
      }

      const latestDestination = db.prepare(
        `SELECT id
         FROM seller_payout_accounts
         WHERE seller_uid = ?
           AND is_default = 1
           AND is_active = 1
           AND verification_status = 'verified'
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
      ).get(payout.sellerId) as { id: string } | undefined;

      if (!latestDestination) {
        return res.status(400).json({ error: 'No active verified default destination found for seller' });
      }

      if (payout.destinationAccountId === latestDestination.id) {
        return res.status(200).json({
          payoutId: payout.id,
          sellerId: payout.sellerId,
          status: payout.status,
          destinationAccountId: payout.destinationAccountId,
          updated: false,
        });
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE payouts
         SET destination_account_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(latestDestination.id, now, payout.id);

      payoutService.addEvent({
        payoutId: payout.id,
        sellerId: payout.sellerId,
        eventType: 'payout_destination_rebound',
        actorType: 'admin',
        actorId: String(req.user?.uid || 'admin'),
        note: 'Destination rebound to seller default verified destination',
        payload: {
          previousDestinationAccountId: payout.destinationAccountId,
          nextDestinationAccountId: latestDestination.id,
          payoutStatus: payout.status,
        },
      });

      return res.status(200).json({
        payoutId: payout.id,
        sellerId: payout.sellerId,
        status: payout.status,
        destinationAccountId: latestDestination.id,
        updated: true,
      });
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to rebind payout destination'));
    }
  });

  router.post('/payouts/reconcile-pending', payoutLimiter, requireAuth, async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const results = await payoutService.reconcilePendingPayoutStatuses({
        actorType: 'admin',
        actorId: String(req.user?.uid || 'admin'),
        limit: Number(req.body?.limit ?? 25),
      });
      return res.status(200).json({ results });
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to reconcile pending payouts'));
    }
  });

  router.get('/payouts/:payoutId/adjustments', requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const adjustments = getPaymentDb().prepare(
        `SELECT
           id,
           payout_id AS payoutId,
           seller_id AS sellerId,
           adjustment_type AS adjustmentType,
           amount,
           currency,
           reason,
           actor_type AS actorType,
           actor_id AS actorId,
           provider_reference AS providerReference,
           created_at AS createdAt
         FROM payout_adjustments
         WHERE payout_id = ?
         ORDER BY id DESC`,
      ).all(String(req.params.payoutId));
      return res.status(200).json({ adjustments });
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to load payout adjustments'));
    }
  });

  router.post('/payouts/:payoutId/adjustments', payoutLimiter, requireAuth, (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const payoutId = String(req.params.payoutId || '').trim();
      const adjustmentType = normalizeText(req.body?.adjustmentType);
      if (adjustmentType !== 'processing_fee' && adjustmentType !== 'manual_adjustment') {
        return res.status(400).json({ error: 'adjustmentType must be processing_fee or manual_adjustment' });
      }
      const amount = normalizeAmount(req.body?.amount);
      const reason = normalizeText(req.body?.reason);
      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      const db = getPaymentDb();
      const row = db.prepare(`SELECT * FROM payouts WHERE id = ? LIMIT 1`).get(payoutId) as Record<string, unknown> | undefined;
      if (!row) {
        return res.status(404).json({ error: 'Payout not found' });
      }

      const sellerId = String(row.seller_id);
      const actorId = String(req.user?.uid || 'admin');
      const adjustmentId = insertPayoutAdjustment({
        payoutId,
        sellerId,
        adjustmentType,
        amount,
        currency: String(row.currency ?? 'MWK'),
        reason,
        actorType: 'admin',
        actorId,
        providerReference: normalizeText(req.body?.providerReference),
      });

      const nextProcessingFeeAmount = adjustmentType === 'processing_fee'
        ? amount
        : normalizeAmount(row.processing_fee_amount ?? 0);
      const nextManualAdjustmentAmount = adjustmentType === 'manual_adjustment'
        ? amount
        : normalizeAmount(row.manual_adjustment_amount ?? 0);
      const formula = recalculatePayoutFinancials(row, {
        manualAdjustmentAmount: nextManualAdjustmentAmount,
      });
      const now = new Date().toISOString();

      db.prepare(
        `UPDATE payouts
         SET gross_amount = ?,
             platform_fee_amount = ?,
             processing_fee_amount = ?,
             reserve_amount = ?,
             reserve_cap_amount = ?,
             manual_adjustment_amount = ?,
             net_amount = ?,
             amount = ?,
             formula_snapshot = ?,
             last_adjustment_id = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        formula.grossAmount,
        formula.platformFeeAmount,
        nextProcessingFeeAmount,
        formula.reserveAmount,
        formula.reserveCapAmount,
        formula.manualAdjustmentAmount,
        formula.netAmount,
        formula.netAmount,
        JSON.stringify(formula),
        String(adjustmentId),
        now,
        payoutId,
      );

      payoutService.addEvent({
        payoutId,
        sellerId,
        eventType: 'payout_adjusted',
        actorType: 'admin',
        actorId,
        note: reason,
        payload: {
          adjustmentId,
          adjustmentType,
          amount,
          legacyProcessingFeeAmount: nextProcessingFeeAmount,
          payoutFormula: formula,
        },
      });

      return res.status(200).json({ payoutId, adjustmentId, formula });
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to create payout adjustment'));
    }
  });

  return router;
}
