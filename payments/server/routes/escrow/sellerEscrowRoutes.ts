import express, { type RequestHandler } from "express";
import { query } from "../../postgres.js";

export function createSellerEscrowRouter(requireAuth: RequestHandler) {
  const router = express.Router();

  router.get("/me", requireAuth, async (req, res) => {
    try {
      const sellerId = req.user?.uid;

      if (!sellerId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const result = await query(`
        SELECT
          COALESCE(e.id, o.id) as id,
          e.order_id as "orderId",
          COALESCE(e.state, o.status) as state,
          COALESCE(e.status, o.status) as status,
          COALESCE(e.balance_amount, o.total_amount) as "balanceAmount",
          COALESCE(e.total_amount, o.total_amount) as "totalAmount",
          COALESCE(e.currency, o.total_currency) as currency,
          COALESCE(e.created_at, o.created_at) as "createdAt",
          COALESCE(e.updated_at, o.updated_at) as "updatedAt"
        FROM orders o
        LEFT JOIN escrows e ON e.order_id = o.id
        WHERE o.seller_id = $1
          AND LOWER(COALESCE(e.state, o.status, '')) IN ('initiated', 'funded', 'held', 'disputed', 'in_escrow')
        ORDER BY COALESCE(e.updated_at, o.updated_at) DESC
      `, [sellerId]);

      return res.status(200).json(result.rows);
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to load seller escrows",
      });
    }
  });

  return router;
}
