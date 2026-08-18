import express, { type RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../postgresCompat.js';
import {
  listPayChanguMobileMoneyOperators,
  listPayChanguPayoutBanks,
} from '../../modules/payouts/paychangu.payout.js';
import { escrowRepository } from '../../modules/escrow/escrow.repository.js';
import {
  payoutService,
} from '../../modules/payouts/payout.service.js';
import { PAYOUT_POLICY } from '../../modules/payouts/payout.policy.js';
import { getRequestUser, jsonError, payoutLimiter } from './shared.js';
import {
  DEFAULT_CURRENCY,
  addDestinationEvent,
  assertEditSettingsAccess,
  assertHistoryAccess,
  assertOverrideAccess,
  assertProviderLookupAccess,
  assertRetryAccess,
  assertWithdrawalAccess,
  buildPermissions,
  createDestinationRecord,
  decryptSensitiveValue,
  findDestinationById,
  getActor,
  getRequestSellerId,
  listSellerDestinations,
  listSellerPayoutOperationalView,
  normalizeAccountName,
  normalizeAccountNumber,
  normalizeBankProviderRecords,
  normalizeCurrency,
  normalizeDestinationId,
  normalizeDestinationType,
  normalizeMobileMoneyProviderRecords,
  normalizeMobileNumber,
  normalizeOverrideAction,
  normalizeProviderCurrency,
  normalizeProviderName,
  normalizeProviderRefId,
  normalizeManualPayoutAmount,
  normalizeText,
  updateDestinationRecord,
} from './payoutRoutes.helpers.js';

export function createPayoutRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.get('/permissions/:sellerId', requireAuth, (req, res) => {
    try {
      const sellerId = normalizeDestinationId(req.params.sellerId);
      return res.json({ sellerId, permissions: buildPermissions(sellerId, getActor(req)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load payout permissions';
      return res.status(/Unauthorized/i.test(message) ? 401 : 400).json({ error: message });
    }
  });

  router.get('/metadata', requireAuth, (_req, res) => {
    return res.json({
      mobileMoneyOperators: [],
      banks: [],
      currencies: [DEFAULT_CURRENCY],
      launchPolicy: PAYOUT_POLICY.launchMode,
    });
  });

  router.get('/provider/mobile-money-operators', requireAuth, async (req, res) => {
    try {
      assertProviderLookupAccess(req);
      const operators = await listPayChanguMobileMoneyOperators();
      return res.json({ operators: normalizeMobileMoneyProviderRecords(operators) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load mobile money operators';
      const status = /Unauthorized/i.test(message) ? 401 : /not allowed/i.test(message) ? 403 : 502;
      return res.status(status).json({ error: message });
    }
  });

  router.get('/provider/banks', requireAuth, async (req, res) => {
    try {
      assertProviderLookupAccess(req);
      const currency = normalizeProviderCurrency(req.query.currency);
      const banks = await listPayChanguPayoutBanks(currency);
      return res.json({ banks: normalizeBankProviderRecords(banks), currency });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load payout banks';
      const status = /Unauthorized/i.test(message)
        ? 401
        : /not allowed/i.test(message)
          ? 403
          : /Only MWK payout provider lookups/i.test(message)
            ? 400
            : 502;
      return res.status(status).json({ error: message });
    }
  });

  router.get('/destinations', requireAuth, (req, res) => {
    try {
      const sellerId = getRequestSellerId(req, req.query.sellerUid);
      assertEditSettingsAccess(req, sellerId);
      return res.json({ destinations: listSellerDestinations(sellerId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load payout destinations';
      const status = /Unauthorized/i.test(message) ? 401 : 403;
      return res.status(status).json(jsonError(error, 'Failed to load payout destinations'));
    }
  });

  router.post('/destinations', payoutLimiter, requireAuth, (req, res) => {
    try {
      const sellerId = getRequestSellerId(req, req.body.sellerUid);
      assertEditSettingsAccess(req, sellerId);

      const destinationType = normalizeDestinationType(req.body.destinationType);
      const providerName = normalizeProviderName(req.body.providerName);
      const providerRefId = normalizeProviderRefId(req.body.providerRefId);
      const currency = normalizeCurrency(req.body.currency);
      const accountName = normalizeAccountName(req.body.accountName);
      const isDefault = req.body.isDefault === true;

      const created =
        destinationType === 'bank'
          ? createDestinationRecord({
              sellerId,
              destinationType,
              providerName,
              providerRefId,
              currency,
              accountName,
              accountNumber: normalizeAccountNumber(req.body.accountNumber),
              isDefault,
            })
          : createDestinationRecord({
              sellerId,
              destinationType,
              providerName,
              providerRefId,
              currency,
              accountName,
              mobile: normalizeMobileNumber(req.body.mobile),
              isDefault,
            });

      addDestinationEvent({
        sellerId,
        accountId: created.id,
        eventType: 'destination_added',
        actorType: req.user?.is_admin ? 'admin' : 'seller',
        actorId: req.user?.uid ?? null,
        payload: { destinationType: created.destinationType, providerName: created.providerName },
      });

      return res.status(201).json({ destination: created });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create payout destination';
      const status = /already exists/i.test(message) ? 409 : /Unauthorized/i.test(message) ? 401 : 403;
      return res.status(status).json({ error: message });
    }
  });

  router.patch('/destinations/:id', payoutLimiter, requireAuth, (req, res) => {
    try {
      const destinationId = normalizeDestinationId(req.params.id);
      const existing = findDestinationById(destinationId);
      if (!existing) {
        return res.status(404).json({ error: 'Payout destination not found' });
      }
      assertEditSettingsAccess(req, existing.seller_uid);

      const destinationType = req.body.destinationType ? normalizeDestinationType(req.body.destinationType) : undefined;
      const providerName = req.body.providerName ? normalizeProviderName(req.body.providerName) : undefined;
      const providerRefId = req.body.providerRefId !== undefined ? normalizeProviderRefId(req.body.providerRefId) : undefined;
      const currency = req.body.currency !== undefined ? normalizeCurrency(req.body.currency) : undefined;
      const accountName = req.body.accountName !== undefined ? normalizeAccountName(req.body.accountName) : undefined;
      const isDefault = req.body.isDefault === true;

      const currentType = destinationType ?? existing.destination_type;
      const accountNumber = currentType === 'bank'
        ? (req.body.accountNumber !== undefined ? normalizeAccountNumber(req.body.accountNumber) : decryptSensitiveValue(existing.account_number_encrypted) ?? '')
        : null;
      const mobile = currentType === 'mobile_money'
        ? (req.body.mobile !== undefined ? normalizeMobileNumber(req.body.mobile) : decryptSensitiveValue(existing.mobile_encrypted) ?? '')
        : null;

      const updated = updateDestinationRecord(existing, {
        destinationType,
        providerName,
        providerRefId,
        currency,
        accountName,
        accountNumber,
        mobile,
        isDefault,
      });

      addDestinationEvent({
        sellerId: existing.seller_uid,
        accountId: updated.id,
        eventType: 'destination_updated',
        actorType: req.user?.is_admin ? 'admin' : 'seller',
        actorId: req.user?.uid ?? null,
        payload: { destinationType: updated.destinationType, providerName: updated.providerName },
      });

      return res.json({ destination: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update payout destination';
      const status = /already exists/i.test(message)
        ? 409
        : /Unauthorized/i.test(message)
          ? 401
          : /not allowed/i.test(message)
            ? 403
            : 400;
      return res.status(status).json({ error: message });
    }
  });

  router.delete('/destinations/:id', payoutLimiter, requireAuth, (req, res) => {
    try {
      const destinationId = normalizeDestinationId(req.params.id);
      const existing = findDestinationById(destinationId);
      if (!existing) {
        return res.status(404).json({ error: 'Payout destination not found' });
      }
      assertEditSettingsAccess(req, existing.seller_uid);

      if (existing.is_default === 1) {
        return res.status(409).json({ error: 'Default payout destination cannot be removed. Replace it instead.' });
      }

      const db = getPaymentDb();
      db.transaction(() => {
        db.prepare('DELETE FROM seller_payout_account_events WHERE account_id = ?').run(existing.id);
        db.prepare('DELETE FROM seller_payout_accounts WHERE id = ?').run(existing.id);
      })();

      return res.json({ deletedDestinationId: existing.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove payout destination';
      const status = /Unauthorized/i.test(message) ? 401 : /not allowed/i.test(message) ? 403 : 400;
      return res.status(status).json({ error: message });
    }
  });

  router.post('/destinations/:id/replace', payoutLimiter, requireAuth, (req, res) => {
    try {
      const destinationId = normalizeDestinationId(req.params.id);
      const existing = findDestinationById(destinationId);
      if (!existing) {
        return res.status(404).json({ error: 'Payout destination not found' });
      }
      assertEditSettingsAccess(req, existing.seller_uid);

      const destinationType = req.body.destinationType ? normalizeDestinationType(req.body.destinationType) : existing.destination_type;
      const providerName = req.body.providerName ? normalizeProviderName(req.body.providerName) : existing.provider_name;
      const providerRefId = req.body.providerRefId !== undefined ? normalizeProviderRefId(req.body.providerRefId) : existing.provider_ref_id;
      const currency = req.body.currency !== undefined ? normalizeCurrency(req.body.currency) : existing.currency;
      const accountName = req.body.accountName !== undefined ? normalizeAccountName(req.body.accountName) : existing.account_name;
      const isDefault = req.body.isDefault === true || existing.is_default === 1;

      const accountNumber = destinationType === 'bank'
        ? normalizeAccountNumber(req.body.accountNumber !== undefined ? req.body.accountNumber : decryptSensitiveValue(existing.account_number_encrypted) ?? '')
        : null;
      const mobile = destinationType === 'mobile_money'
        ? normalizeMobileNumber(req.body.mobile !== undefined ? req.body.mobile : decryptSensitiveValue(existing.mobile_encrypted) ?? '')
        : null;

      const sameAsCurrent =
        destinationType === existing.destination_type &&
        providerName === existing.provider_name &&
        providerRefId === existing.provider_ref_id &&
        currency === existing.currency &&
        accountName === existing.account_name &&
        ((destinationType === 'bank' && accountNumber === decryptSensitiveValue(existing.account_number_encrypted)) ||
          (destinationType === 'mobile_money' && mobile === decryptSensitiveValue(existing.mobile_encrypted)));

      if (sameAsCurrent) {
        throw new Error('Replacement must change at least one payout detail');
      }

      const created = createDestinationRecord({
        sellerId: existing.seller_uid,
        destinationType,
        providerName,
        providerRefId,
        currency,
        accountName,
        accountNumber: destinationType === 'bank' ? accountNumber ?? undefined : undefined,
        mobile: destinationType === 'mobile_money' ? mobile ?? undefined : undefined,
        isDefault,
        sourceId: existing.id,
      });

      const db = getPaymentDb();
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE seller_payout_accounts
         SET is_active = 0,
             replaced_by_id = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(created.id, now, existing.id);
      db.prepare(
        `UPDATE seller_payout_accounts
         SET replaced_from_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(existing.id, now, created.id);

      addDestinationEvent({
        sellerId: existing.seller_uid,
        accountId: created.id,
        eventType: 'destination_replaced',
        actorType: req.user?.is_admin ? 'admin' : 'seller',
        actorId: req.user?.uid ?? null,
        payload: { replacedFromId: existing.id, replacedById: created.id },
      });

      return res.status(201).json({ destination: created, replacedDestinationId: existing.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to replace payout destination';
      const status = /already exists/i.test(message)
        ? 409
        : /Unauthorized/i.test(message)
          ? 401
          : /not allowed/i.test(message)
            ? 403
            : 400;
      return res.status(status).json({ error: message });
    }
  });

  router.post('/withdrawals', payoutLimiter, requireAuth, (req, res) => {
    try {
      const sellerId = getRequestSellerId(req, req.body.sellerUid);
      assertWithdrawalAccess(req, sellerId);
      if (PAYOUT_POLICY.launchMode === 'admin_approved' && !req.user?.is_admin) {
        return res.status(403).json({ error: 'Seller withdrawal requests are disabled while launch mode is admin-approved' });
      }
      return res.status(202).json({ status: 'queued_for_admin_review', sellerId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request withdrawal';
      const status = /Unauthorized/i.test(message) ? 401 : 403;
      return res.status(status).json({ error: message });
    }
  });

  router.get('/history/:sellerId', requireAuth, (req, res) => {
    try {
      const sellerId = normalizeDestinationId(req.params.sellerId);
      assertHistoryAccess(req, sellerId);
      return res.json({ payouts: listSellerPayoutOperationalView(sellerId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load payout history';
      const status = /Unauthorized/i.test(message) ? 401 : 403;
      return res.status(status).json({ error: message });
    }
  });

  router.post('/:sellerId/retry', payoutLimiter, requireAuth, async (req, res) => {
    try {
      const sellerId = normalizeDestinationId(req.params.sellerId);
      assertRetryAccess(req, sellerId);
      const payoutId = normalizeDestinationId(req.body?.payoutId);
      if (PAYOUT_POLICY.launchMode === 'admin_approved' && !req.user?.is_admin) {
        return res.status(403).json({ error: 'Seller retry is disabled while launch mode is admin-approved' });
      }
      const result = await payoutService.executePayout({
        payoutId,
        actorType: req.user?.is_admin ? 'admin' : 'system',
        actorId: req.user?.uid ?? null,
      });
      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request payout retry';
      const status = /Unauthorized/i.test(message) ? 401 : 403;
      return res.status(status).json({ error: message });
    }
  });

  router.post('/:sellerId/override', payoutLimiter, requireAuth, (req, res) => {
    try {
      assertOverrideAccess(req);
      const sellerId = normalizeDestinationId(req.params.sellerId);
      const payoutId = normalizeDestinationId(req.body?.payoutId);
      const reason = normalizeText(req.body?.reason);
      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }
      const action = normalizeOverrideAction(req.body?.action);
      const payout = payoutService.applyAdminOverride({
        payoutId,
        sellerId,
        action,
        actorId: req.user?.uid ?? 'admin',
        reason,
      });
      if (!payout) {
        return res.status(404).json({ error: 'Payout not found' });
      }
      return res.status(200).json({ payout });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve payout override';
      const status = /Unauthorized/i.test(message)
        ? 401
        : /action must be one of|reason is required|Invalid admin override transition|does not belong to the provided seller/i.test(message)
          ? 400
          : 403;
      return res.status(status).json({ error: message });
    }
  });

  router.post('/', payoutLimiter, requireAuth, async (req, res) => {
    try {
      if (!req.user?.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const {
        sellerId,
        orderId,
        amount,
        destinationAccountId,
        grossAmount,
        platformFeeAmount,
        processingFeeAmount,
        reserveAmount,
        reserveCapAmount,
        manualAdjustmentAmount,
        netAmount,
        formulaSnapshot,
        reason,
        currency = 'MWK',
      } = req.body as {
        sellerId?: string;
        orderId?: string;
        amount?: number;
        destinationAccountId?: string;
        grossAmount?: number;
        platformFeeAmount?: number;
        processingFeeAmount?: number;
        reserveAmount?: number;
        reserveCapAmount?: number;
        manualAdjustmentAmount?: number;
        netAmount?: number;
        formulaSnapshot?: Record<string, unknown>;
        reason?: string;
        currency?: string;
      };

      if (!sellerId || amount === undefined) {
        return res.status(400).json({ error: 'sellerId and amount are required' });
      }

      const adminReason = normalizeText(reason);
      if (!adminReason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      const normalizedAmount = normalizeManualPayoutAmount(amount);
      const normalizedCurrency = normalizeCurrency(currency);
      const now = new Date().toISOString();
      const id = randomUUID();
      const normalizedSellerId = normalizeDestinationId(sellerId);
      const normalizedDestinationAccountId = destinationAccountId === undefined ? null : normalizeDestinationId(destinationAccountId);

      const db = getPaymentDb();
      const escrow = orderId ? escrowRepository.findByOrderId(orderId) : undefined;

      db.prepare(
        `INSERT INTO payouts (
          id,
          seller_id,
          order_id,
          escrow_id,
          amount,
          gross_amount,
          platform_fee_amount,
          processing_fee_amount,
          reserve_amount,
          reserve_cap_amount,
          manual_adjustment_amount,
          payout_fee_amount,
          seller_receives_amount,
          net_amount,
          formula_snapshot,
          currency,
          status,
          destination_account_id,
          requested_by,
          requested_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'eligible', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        normalizedSellerId,
        orderId ?? null,
        escrow?.id ?? null,
        normalizedAmount,
        grossAmount ?? normalizedAmount,
        platformFeeAmount ?? 0,
        processingFeeAmount ?? 0,
        reserveAmount ?? 0,
        reserveCapAmount ?? 0,
        manualAdjustmentAmount ?? 0,
        0,
        netAmount ?? normalizedAmount,
        netAmount ?? normalizedAmount,
        JSON.stringify(formulaSnapshot ?? {}),
        normalizedCurrency,
        normalizedDestinationAccountId,
        req.user.uid,
        now,
        now,
        now,
      );

      payoutService.addEvent({
        payoutId: id,
        sellerId: normalizedSellerId,
        eventType: 'manual_payout_created',
        actorType: 'admin',
        actorId: req.user.uid,
        note: adminReason,
        payload: {
          reason: adminReason,
          destinationAccountId: normalizedDestinationAccountId,
          formulaSnapshot: formulaSnapshot ?? {},
        },
      });

      const execution = await payoutService.executePayout({
        payoutId: id,
        actorType: 'admin',
        actorId: req.user.uid,
      });
      const created = payoutService.findById(id);

      return res.status(201).json({
        id,
        sellerId: normalizedSellerId,
        orderId,
        amount: normalizedAmount,
        currency: normalizedCurrency,
        status: created?.status ?? 'eligible',
        nextAction: execution.nextAction,
        reasonCode: execution.reasonCode,
        reason: execution.reason,
        createdAt: now,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process payout';
      const status = /reason is required|amount must be a positive integer|Destination id is required|Only MWK/i.test(message)
        ? 400
        : /Unauthorized/i.test(message)
          ? 401
          : 500;
      return res.status(status).json(jsonError(error, 'Failed to process payout'));
    }
  });

  return router;
}
