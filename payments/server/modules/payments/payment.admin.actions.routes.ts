import express, { type RequestHandler } from 'express';
import { hasAdminAccess } from '../../auth/adminAccess.js';
import { payoutLimiter } from '../../routes/escrow/shared.js';
import { normalizeOverrideAction, normalizeText } from '../../routes/escrow/payoutRoutes.helpers.js';
import { payoutService } from '../payouts/payout.service.js';

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!hasAdminAccess(req.user)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

export function createPaymentAdminActionRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.post('/payouts/:payoutId/retry', payoutLimiter, requireAuth, async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const payoutId = String(req.params.payoutId ?? '').trim();
      if (!payoutId) {
        return res.status(400).json({ error: 'payoutId is required' });
      }

      const result = await payoutService.executePayout({
        payoutId,
        actorType: 'admin',
        actorId: req.user?.uid ?? null,
      });

      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retry payout';
      const status = /Admin access required/i.test(message) ? 403 : 400;
      return res.status(status).json({ error: message });
    }
  });

  router.post('/payouts/:payoutId/override', payoutLimiter, requireAuth, async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;

      const payoutId = String(req.params.payoutId ?? '').trim();
      if (!payoutId) {
        return res.status(400).json({ error: 'payoutId is required' });
      }

      const action = normalizeOverrideAction(req.body?.action);
      const reason = normalizeText(req.body?.reason);
      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      const payout = payoutService.applyAdminOverride({
        payoutId,
        action,
        actorId: req.user?.uid ?? 'admin',
        reason,
        sellerId: normalizeText(req.body?.sellerId) ?? undefined,
      });

      if (!payout) {
        return res.status(404).json({ error: 'Payout not found' });
      }

      return res.status(200).json({ payout });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply payout override';
      const status = /Admin access required/i.test(message) ? 403 : /reason is required/i.test(message) ? 400 : 400;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}