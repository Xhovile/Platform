import express, { type RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../postgres.js';
import { escrowRepository } from '../../modules/escrow/escrow.repository.js';
import { serverOrderService } from '../../modules/orders/order.service.js';
import { assertAllowedDisputeTransition, type DisputeStatus } from './disputeState.js';
import {
  assertOrderAccessAsync,
  disputeLimiter,
  jsonError,
} from './shared.js';

export function createDisputeRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.post('/', disputeLimiter, requireAuth, async (req, res) => {
    try {
      const { orderId, reason } = req.body as { orderId?: string; reason?: string };

      if (!orderId || !reason) {
        return res.status(400).json({ error: 'orderId and reason are required' });
      }

      const access = await assertOrderAccessAsync(req, orderId);
      if ('error' in access) return res.status(access.error.status).json(access.error.body);

      const openedBy = req.user!.uid;
      const now = new Date().toISOString();

      const result = await withTransaction(async (client) => {
        const existingResult = await client.query<Record<string, unknown>>(
          `SELECT * FROM disputes
           WHERE order_id = $1 AND status = 'open'
           ORDER BY created_at ASC LIMIT 1`,
          [orderId],
        );

        const existing = existingResult.rows[0];
        if (existing) return { created: false, dispute: existing };

        const id = randomUUID();
        const escrow = await escrowRepository.findByOrderIdAsync(orderId, client);

        await client.query(
          `INSERT INTO disputes (
            id, order_id, escrow_id, opened_by, reason, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)`,
          [id, orderId, escrow?.id ?? null, openedBy, reason, now, now],
        );

        if (escrow) {
          await escrowRepository.updateStateAsync(orderId, 'disputed', client);
          const updatedOrder = await serverOrderService.setStatusAsync(orderId, 'disputed', client);
          if (!updatedOrder) throw new Error('Order not found while opening dispute');
        }

        const createdResult = await client.query<Record<string, unknown>>(
          'SELECT * FROM disputes WHERE id = $1 LIMIT 1',
          [id],
        );
        const created = createdResult.rows[0];
        if (!created) throw new Error('Failed to create dispute');

        return { created: true, dispute: created };
      });

      return res.status(result.created ? 201 : 200).json({
        id: result.dispute.id,
        orderId: result.dispute.order_id,
        openedBy: result.dispute.opened_by,
        reason: result.dispute.reason,
        status: result.dispute.status,
        createdAt: result.dispute.created_at,
        alreadyOpen: !result.created,
      });
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to open dispute'));
    }
  });

  router.get('/:orderId', disputeLimiter, requireAuth, async (req, res) => {
    try {
      const access = await assertOrderAccessAsync(req, req.params.orderId);
      if ('error' in access) return res.status(access.error.status).json(access.error.body);

      const result = await query<Record<string, unknown>>(
        'SELECT * FROM disputes WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.params.orderId],
      );

      const dispute = result.rows[0];
      if (!dispute) return res.status(404).json({ error: 'No dispute found for this order' });
      return res.status(200).json(dispute);
    } catch (error) {
      return res.status(500).json(jsonError(error, 'Failed to fetch dispute'));
    }
  });

  router.patch('/:id', disputeLimiter, requireAuth, async (req, res) => {
    try {
      if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin access required' });

      const { status, resolutionNote } = req.body as { status?: string; resolutionNote?: string };
      if (!status || !['resolved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'status must be "resolved" or "rejected"' });
      }

      const existingResult = await query<{ status?: string }>(
        'SELECT status FROM disputes WHERE id = $1',
        [req.params.id],
      );
      const existing = existingResult.rows[0];
      if (!existing) return res.status(404).json({ error: 'Dispute not found' });

      assertAllowedDisputeTransition(existing.status as DisputeStatus, status as DisputeStatus);

      const now = new Date().toISOString();
      await query(
        `UPDATE disputes
         SET status = $1, resolved_by = $2, resolution_note = $3, updated_at = $4
         WHERE id = $5`,
        [status, req.user.uid, resolutionNote ?? null, now, req.params.id],
      );

      const updatedResult = await query<Record<string, unknown>>(
        'SELECT * FROM disputes WHERE id = $1',
        [req.params.id],
      );

      return res.status(200).json(updatedResult.rows[0]);
    } catch (error) {
      return res.status(400).json(jsonError(error, 'Failed to resolve dispute'));
    }
  });

  return router;
}