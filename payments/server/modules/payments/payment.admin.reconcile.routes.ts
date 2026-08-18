import express, { type RequestHandler } from 'express';
import { hasAdminAccess } from '../../auth/adminAccess.js';
import { payoutService } from '../payouts/payout.service.js';
import { payoutLimiter } from '../../routes/escrow/shared.js';

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!hasAdminAccess(req.user)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function parseBatchLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 25);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

export function createPaymentAdminReconcileRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  const handleReconcile = async (req: any, res: express.Response) => {
    try {
      if (!requireAdmin(req, res)) return;

      const limit = parseBatchLimit(req.body?.limit ?? req.query?.limit);
      const results = await payoutService.reconcilePendingPayoutStatuses({
        actorType: 'admin',
        actorId: req.user?.uid ?? null,
        limit,
      });

      return res.status(200).json({
        success: true,
        results,
        limit,
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to reconcile payouts',
      });
    }
  };

  router.post('/payouts/reconcile', payoutLimiter, requireAuth, handleReconcile);
  router.post('/payouts/reconcile-pending', payoutLimiter, requireAuth, handleReconcile);

  return router;
}
