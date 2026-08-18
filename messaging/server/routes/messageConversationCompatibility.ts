import type { Express } from "express";
import { postgresDb as db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.messageConversationCompatibilityRoutesInstalled");

export function registerMessageConversationCompatibilityRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.delete("/api/messages/:conversationId", requireAuth, (req: any, res) => {
    const uid = String(req.user?.uid ?? "").trim();
    const conversationId = Number(req.params.conversationId);

    if (!uid) return res.status(401).json({ error: "Authentication required" });
    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation id" });
    }

    try {
      const conversation = db
        .prepare(
          `SELECT id, buyer_uid, seller_uid
           FROM conversations
           WHERE id = ?
           LIMIT 1`,
        )
        .get(conversationId) as { id: number; buyer_uid: string; seller_uid: string } | undefined;

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const isAdmin = req.user?.is_admin === true;
      const hasAccess = isAdmin || conversation.buyer_uid === uid || conversation.seller_uid === uid;
      if (!hasAccess) {
        return res.status(403).json({ error: "You cannot delete this conversation" });
      }

      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(conversationId);
      db.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);

      return res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete conversation", error);
      return res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}
