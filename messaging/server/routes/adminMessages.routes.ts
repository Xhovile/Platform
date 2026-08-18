import type { RequestHandler, Router } from "express";
import { Router as createRouter } from "express";
import { hasAdminAccess } from "../auth/adminAccess.js";
import {
  ADMIN_ACTION_TYPES,
  ADMIN_TARGET_TYPES,
  type AdminActionType,
  type AdminTargetType,
} from "../../src/modules/admin/shared/adminAuditTypes.js";

type AdminUser = { uid: string; email?: string | null; is_admin?: boolean };

type AdminMessageRouterDeps = {
  requireAuth: RequestHandler;
  db: any;
};

function clean(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function requireAdmin(requireAuth: RequestHandler): RequestHandler[] {
  return [
    requireAuth,
    (req, res, next) => {
      if (!hasAdminAccess(req.user)) return res.status(403).json({ error: "Admin access required" });
      next();
    },
  ];
}

function ensureAdminMessageSchema(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_message_reviews (
      conversation_id INTEGER NOT NULL,
      admin_uid TEXT NOT NULL,
      reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, admin_uid)
    );

    CREATE TABLE IF NOT EXISTS message_restrictions (
      conversation_id INTEGER NOT NULL,
      restricted_uid TEXT NOT NULL,
      reason TEXT,
      created_by_uid TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, restricted_uid)
    );

    CREATE INDEX IF NOT EXISTS idx_admin_message_reviews_admin
      ON admin_message_reviews (admin_uid, reviewed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_message_reviews_conversation
      ON admin_message_reviews (conversation_id, reviewed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_reports_conversation
      ON message_reports (conversation_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_blocks_blocker
      ON message_blocks (blocker_uid, blocked_uid, block_scope);
    CREATE INDEX IF NOT EXISTS idx_message_blocks_blocked
      ON message_blocks (blocked_uid, blocker_uid, block_scope);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations (updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_buyer_updated
      ON conversations (buyer_uid, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_seller_updated
      ON conversations (seller_uid, updated_at DESC, id DESC);

    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS reviewed_by_uid TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS reviewed_at DATETIME;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolution TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolved_by_uid TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolved_by_email TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolved_at DATETIME;

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_spam INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS spam_flag_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;
  `);
}

function getConversation(db: any, conversationId: number) {
  return db.prepare(`
    SELECT
      c.id, c.listing_id, c.event_id, c.buyer_uid, c.seller_uid,
      c.last_message_preview, c.last_message_at, c.created_at, c.updated_at,
      l.name AS listing_name,
      e.event_title AS event_title,
      e.organizer_name AS organizer_name,
      e.creator_uid AS event_creator_uid,
      buyer.email AS buyer_email,
      buyer.business_name AS buyer_business_name,
      buyer.is_suspended AS buyer_is_suspended,
      seller.email AS seller_email,
      seller.business_name AS seller_business_name,
      seller.is_suspended AS seller_is_suspended,
      ec.email AS organizer_email,
      ec.organization_name AS organizer_business_name,
      ec.status AS organizer_status,
      CASE WHEN mb.conversation_id IS NULL THEN 'open' ELSE 'blocked' END AS conversation_block_state,
      CASE WHEN mr.conversation_id IS NULL THEN 'open' ELSE 'restricted' END AS conversation_restriction_state
    FROM conversations c
    LEFT JOIN listings l ON l.id = c.listing_id
    LEFT JOIN events e ON e.id = c.event_id
    LEFT JOIN sellers buyer ON buyer.uid = c.buyer_uid
    LEFT JOIN sellers seller ON seller.uid = c.seller_uid
    LEFT JOIN event_creators ec ON ec.uid = c.seller_uid
    LEFT JOIN (
      SELECT DISTINCT c2.id AS conversation_id
      FROM conversations c2
      INNER JOIN message_blocks b
        ON (b.blocker_uid = c2.buyer_uid AND b.blocked_uid = c2.seller_uid)
        OR (b.blocker_uid = c2.seller_uid AND b.blocked_uid = c2.buyer_uid)
      WHERE b.block_scope IN ('messages', 'all')
    ) mb ON mb.conversation_id = c.id
    LEFT JOIN (
      SELECT DISTINCT conversation_id
      FROM message_restrictions
    ) mr ON mr.conversation_id = c.id
    WHERE c.id = ?
    LIMIT 1
  `).get(conversationId);
}

function getConversationState(db: any, conversationId: number) {
  const blocked = db.prepare(`
    SELECT blocker_uid, blocked_uid, block_scope, reason, created_at
    FROM message_blocks
    WHERE ((blocker_uid = (SELECT buyer_uid FROM conversations WHERE id = ?) AND blocked_uid = (SELECT seller_uid FROM conversations WHERE id = ?))
       OR (blocker_uid = (SELECT seller_uid FROM conversations WHERE id = ?) AND blocked_uid = (SELECT buyer_uid FROM conversations WHERE id = ?)))
      AND block_scope IN ('messages', 'all')
    ORDER BY created_at DESC
  `).all(conversationId, conversationId, conversationId, conversationId) as any[];
  const restrictions = db.prepare(`
    SELECT restricted_uid, reason, created_by_uid, created_at, updated_at
    FROM message_restrictions
    WHERE conversation_id = ?
    ORDER BY created_at DESC
  `).all(conversationId) as any[];
  return {
    conversation_state: blocked.length ? "Blocked" : restrictions.length ? "Restricted" : "Open",
    blocked,
    restrictions,
  };
}

function parseCursor(value: unknown) {
  const raw = clean(value, 240);
  if (!raw) return null;
  const idx = raw.lastIndexOf("|");
  if (idx < 1) return null;
  const updatedAt = raw.slice(0, idx);
  const id = Number(raw.slice(idx + 1));
  return updatedAt && Number.isSafeInteger(id) ? { updatedAt, id } : null;
}

function encodeCursor(row: any) {
  return `${row.updated_at}|${row.id}`;
}

function safeJson(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function logAction(db: any, user: AdminUser, actionType: AdminActionType, targetType: AdminTargetType, targetId: string | null, details: Record<string, unknown>) {
  db.prepare(`
    INSERT INTO admin_actions (admin_uid, admin_email, action_type, target_id, details, target_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    user.uid,
    user.email ?? null,
    actionType,
    targetId,
    JSON.stringify(details),
    targetType,
  );
}

function resolveParticipant(db: any, conversation: any, uid: string) {
  if (uid !== conversation.buyer_uid && uid !== conversation.seller_uid) return null;
  const seller = db.prepare(`SELECT uid, email, business_name, is_suspended FROM sellers WHERE uid = ? LIMIT 1`).get(uid) as any;
  const organizer = db.prepare(`SELECT uid, email, organization_name, status FROM event_creators WHERE uid = ? LIMIT 1`).get(uid) as any;
  return {
    uid,
    role: uid === conversation.buyer_uid ? "Buyer" : conversation.event_id ? "Organizer" : "Seller",
    email: seller?.email ?? organizer?.email ?? null,
    business_name: seller?.business_name ?? organizer?.organization_name ?? null,
    is_suspended: Number(seller?.is_suspended ?? 0) === 1 || organizer?.status === "suspended",
  };
}

export function createAdminMessagesRouter({ requireAuth, db }: AdminMessageRouterDeps): Router {
  const router = createRouter();
  ensureAdminMessageSchema(db);

  router.get("/messages/summary", ...requireAdmin(requireAuth), (req, res) => {
    const user = req.user as AdminUser;
    try {
      const unread = db.prepare(`
        SELECT COUNT(*) AS count
        FROM conversations c
        LEFT JOIN admin_message_reviews r
          ON r.conversation_id = c.id AND r.admin_uid = ?
        WHERE r.conversation_id IS NULL
      `).get(user.uid)?.count ?? 0;
      const reported = db.prepare(`
        SELECT COUNT(DISTINCT conversation_id) AS count
        FROM message_reports
        WHERE conversation_id IS NOT NULL AND status IN ('open','reviewed')
      `).get()?.count ?? 0;
      const blocked = db.prepare(`
        SELECT COUNT(*) AS count
        FROM conversations c
        WHERE EXISTS (
          SELECT 1 FROM message_blocks mb
          WHERE ((mb.blocker_uid = c.buyer_uid AND mb.blocked_uid = c.seller_uid)
              OR (mb.blocker_uid = c.seller_uid AND mb.blocked_uid = c.buyer_uid))
            AND mb.block_scope IN ('messages','all')
        )
      `).get()?.count ?? 0;
      return res.json({ unread: Number(unread), reported: Number(reported), blocked: Number(blocked) });
    } catch (error) {
      console.error("Admin message summary error:", error);
      return res.status(500).json({ error: "Failed to load message summary" });
    }
  });

  router.get("/messages", ...requireAdmin(requireAuth), (req, res) => {
    const user = req.user as AdminUser;
    const filter = clean(req.query.filter, 20).toLowerCase() || "unread";
    const search = clean(req.query.search, 160).toLowerCase();
    const limitRaw = Number(req.query.limit || 50);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
    const cursor = parseCursor(req.query.cursor);

    if (!["unread", "reported", "blocked", "all"].includes(filter)) {
      return res.status(400).json({ error: "Invalid message filter" });
    }

    const params: any[] = [user.uid];
    const conditions: string[] = [];
    if (filter === "unread") conditions.push("r.conversation_id IS NULL");
    if (filter === "reported") conditions.push("COALESCE(rp.open_report_count, 0) > 0");
    if (filter === "blocked") conditions.push("bl.conversation_id IS NOT NULL");

    if (search) {
      const term = `%${search}%`;
      conditions.push(`(
        LOWER(c.buyer_uid) LIKE ? OR LOWER(c.seller_uid) LIKE ? OR
        LOWER(COALESCE(buyer.email, '')) LIKE ? OR LOWER(COALESCE(seller.email, '')) LIKE ? OR
        LOWER(COALESCE(l.name, '')) LIKE ? OR LOWER(COALESCE(e.event_title, '')) LIKE ? OR
        LOWER(COALESCE(seller.business_name, '')) LIKE ? OR LOWER(COALESCE(buyer.business_name, '')) LIKE ? OR
        CAST(c.id AS TEXT) LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term, term, term);
    }

    if (cursor) {
      conditions.push("(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))");
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }

    params.push(limit + 1);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      const rows = db.prepare(`
        SELECT
          c.id, c.listing_id, c.event_id, c.buyer_uid, c.seller_uid,
          c.last_message_preview, c.last_message_at, c.created_at, c.updated_at,
          l.name AS listing_name,
          e.event_title AS event_title,
          e.organizer_name AS organizer_name,
          seller.email AS seller_email,
          seller.business_name AS seller_business_name,
          buyer.email AS buyer_email,
          buyer.business_name AS buyer_business_name,
          COALESCE(rp.open_report_count, 0) AS open_report_count,
          CASE WHEN bl.conversation_id IS NULL THEN 0 ELSE 1 END AS is_blocked,
          CASE WHEN rst.conversation_id IS NULL THEN 0 ELSE 1 END AS is_restricted,
          CASE WHEN r.conversation_id IS NULL THEN 1 ELSE 0 END AS is_unread
        FROM conversations c
        LEFT JOIN listings l ON l.id = c.listing_id
        LEFT JOIN events e ON e.id = c.event_id
        LEFT JOIN sellers seller ON seller.uid = c.seller_uid
        LEFT JOIN sellers buyer ON buyer.uid = c.buyer_uid
        LEFT JOIN admin_message_reviews r
          ON r.conversation_id = c.id AND r.admin_uid = ?
        LEFT JOIN (
          SELECT conversation_id, COUNT(*) AS open_report_count
          FROM message_reports
          WHERE status IN ('open','reviewed') AND conversation_id IS NOT NULL
          GROUP BY conversation_id
        ) rp ON rp.conversation_id = c.id
        LEFT JOIN (
          SELECT DISTINCT c2.id AS conversation_id
          FROM conversations c2
          INNER JOIN message_blocks mb
            ON (mb.blocker_uid = c2.buyer_uid AND mb.blocked_uid = c2.seller_uid)
            OR (mb.blocker_uid = c2.seller_uid AND mb.blocked_uid = c2.buyer_uid)
          WHERE mb.block_scope IN ('messages','all')
        ) bl ON bl.conversation_id = c.id
        LEFT JOIN (
          SELECT DISTINCT conversation_id
          FROM message_restrictions
        ) rst ON rst.conversation_id = c.id
        ${where}
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT ?
      `).all(...params) as any[];

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return res.json({
        items: page.map((row) => ({
          id: Number(row.id),
          listing_id: row.listing_id == null ? null : Number(row.listing_id),
          event_id: row.event_id == null ? null : Number(row.event_id),
          thread_type: row.event_id ? "event" : row.listing_id ? "listing" : "seller",
          buyer: { uid: String(row.buyer_uid), email: row.buyer_email ? String(row.buyer_email) : null, business_name: row.buyer_business_name ? String(row.buyer_business_name) : null },
          seller: { uid: String(row.seller_uid), email: row.seller_email ? String(row.seller_email) : null, business_name: row.seller_business_name ? String(row.seller_business_name) : null },
          listing: row.listing_id ? { id: Number(row.listing_id), name: String(row.listing_name || "Listing") } : null,
          event: row.event_id ? { id: Number(row.event_id), title: String(row.event_title || "Event"), organizer_name: String(row.organizer_name || "Organizer") } : null,
          last_message_preview: String(row.last_message_preview || ""),
          last_message_at: row.last_message_at ? String(row.last_message_at) : null,
          updated_at: row.updated_at ? String(row.updated_at) : null,
          open_report_count: Number(row.open_report_count || 0),
          is_blocked: Number(row.is_blocked || 0) === 1,
          is_restricted: Number(row.is_restricted || 0) === 1,
          is_unread: Number(row.is_unread || 0) === 1,
        })),
        pagination: {
          limit,
          hasMore,
          nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
        },
      });
    } catch (error) {
      console.error("Admin messages fetch error:", error);
      return res.status(500).json({ error: "Failed to load admin messages" });
    }
  });

  router.get("/messages/:conversationId", ...requireAdmin(requireAuth), (req, res) => {
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ error: "Invalid conversation id" });

    try {
      const conversation = getConversation(db, conversationId);
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });

      const messages = db.prepare(`
        SELECT id, conversation_id, sender_uid, body, is_read, created_at, read_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC, id ASC
      `).all(conversationId) as any[];

      const reports = db.prepare(`
        SELECT id, conversation_id, message_id, reporter_uid, reported_uid, reason, details, status,
               created_at, updated_at, reviewed_by_uid, reviewed_at, resolution,
               resolved_by_uid, resolved_by_email, resolved_at
        FROM message_reports
        WHERE conversation_id = ?
        ORDER BY created_at DESC, id DESC
      `).all(conversationId) as any[];

      const historyRows = db.prepare(`
        SELECT id, admin_uid, admin_email, action_type, target_type, target_id, details, created_at
        FROM admin_actions
        WHERE target_type IN ('conversation','conversation_user','message_report')
          AND (
            target_id = ? OR
            details LIKE ?
          )
        ORDER BY created_at ASC, id ASC
      `).all(String(conversationId), `%\"conversation_id\":${conversationId}%`) as any[];

      const state = getConversationState(db, conversationId);
      const adminUser = req.user as AdminUser;
      const review = db.prepare(`SELECT reviewed_at FROM admin_message_reviews WHERE conversation_id = ? AND admin_uid = ? LIMIT 1`).get(conversationId, adminUser.uid) as any;
      const buyer = resolveParticipant(db, conversation, String(conversation.buyer_uid));
      const seller = resolveParticipant(db, conversation, String(conversation.seller_uid));

      return res.json({
        conversation: {
          id: Number(conversation.id),
          listing_id: conversation.listing_id == null ? null : Number(conversation.listing_id),
          event_id: conversation.event_id == null ? null : Number(conversation.event_id),
          type: conversation.event_id ? "event" : conversation.listing_id ? "listing" : "seller",
          created_at: conversation.created_at,
          last_activity_at: conversation.updated_at,
          buyer,
          seller,
          listing: conversation.listing_id ? { id: Number(conversation.listing_id), name: String(conversation.listing_name || "Listing"), owner_uid: String(conversation.seller_uid) } : null,
          event: conversation.event_id ? { id: Number(conversation.event_id), name: String(conversation.event_title || "Event"), organizer_uid: String(conversation.seller_uid), organizer_name: String(conversation.organizer_name || "Organizer") } : null,
          state: state.conversation_state,
        },
        messages: messages.map((message) => ({ ...message, is_read: !!message.is_read })),
        reports,
        review: { state: review ? "Reviewed" : "Unread", reviewed_at: review?.reviewed_at ?? null },
        history: historyRows.map((row) => ({
          id: Number(row.id), admin_uid: row.admin_uid, admin_email: row.admin_email,
          action_type: row.action_type, target_type: row.target_type,
          target_id: row.target_id, details: safeJson(row.details), created_at: row.created_at,
        })),
        blocked: state.blocked,
        restrictions: state.restrictions,
      });
    } catch (error) {
      console.error("Admin message thread fetch error:", error);
      return res.status(500).json({ error: "Failed to load conversation" });
    }
  });

  router.post("/messages/:conversationId/review", ...requireAdmin(requireAuth), (req, res) => {
    const user = req.user as AdminUser;
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ error: "Invalid conversation id" });
    if (!getConversation(db, conversationId)) return res.status(404).json({ error: "Conversation not found" });

    db.prepare(`
      INSERT INTO admin_message_reviews (conversation_id, admin_uid, reviewed_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (conversation_id, admin_uid)
      DO UPDATE SET reviewed_at = CURRENT_TIMESTAMP
    `).run(conversationId, user.uid);

    try {
      logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_REVIEW_CONVERSATION, ADMIN_TARGET_TYPES.CONVERSATION, String(conversationId), { conversation_id: conversationId });
    } catch (error) {
      console.warn("Failed to audit admin conversation review", error);
    }

    return res.json({ success: true, conversation_id: conversationId, reviewed_at: new Date().toISOString() });
  });

  router.post("/messages/:conversationId/action", ...requireAdmin(requireAuth), (req, res) => {
    const user = req.user as AdminUser;
    const conversationId = Number(req.params.conversationId);
    const action = clean(req.body?.action, 60).toLowerCase();
    const targetUid = clean(req.body?.target_uid, 160);
    const reason = clean(req.body?.reason, 500);
    const reportId = Number(req.body?.report_id);
    const resolution = clean(req.body?.resolution, 500);

    if (!Number.isInteger(conversationId)) return res.status(400).json({ error: "Invalid conversation id" });
    const conversation = getConversation(db, conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const participantUid = targetUid && (targetUid === conversation.buyer_uid || targetUid === conversation.seller_uid)
      ? targetUid
      : null;
    const otherUid = participantUid === conversation.buyer_uid ? conversation.seller_uid : conversation.buyer_uid;

    try {
      if (["block", "unblock", "restrict", "unrestrict", "suspend", "unsuspend"].includes(action) && !participantUid) {
        return res.status(400).json({ error: "target_uid must be a conversation participant for this action" });
      }

      if (action === "block") {
        db.prepare(`
          INSERT INTO message_blocks (blocker_uid, blocked_uid, block_scope, reason, created_at, updated_at)
          VALUES (?, ?, 'messages', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(blocker_uid, blocked_uid, block_scope) DO UPDATE SET reason = excluded.reason, updated_at = CURRENT_TIMESTAMP
        `).run(otherUid, participantUid, reason || "Administrative moderation");
        logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_BLOCK_CONVERSATION_USER, ADMIN_TARGET_TYPES.CONVERSATION_USER, participantUid, { conversation_id: conversationId, target_uid: participantUid, reason });
      } else if (action === "unblock") {
        db.prepare(`DELETE FROM message_blocks WHERE ((blocker_uid = ? AND blocked_uid = ?) OR (blocker_uid = ? AND blocked_uid = ?)) AND block_scope IN ('messages','all')`).run(conversation.buyer_uid, conversation.seller_uid, conversation.seller_uid, conversation.buyer_uid);
        logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_UNBLOCK_CONVERSATION_USER, ADMIN_TARGET_TYPES.CONVERSATION_USER, participantUid, { conversation_id: conversationId, target_uid: participantUid, reason });
      } else if (action === "restrict") {
        db.prepare(`
          INSERT INTO message_restrictions (conversation_id, restricted_uid, reason, created_by_uid, created_at, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(conversation_id, restricted_uid) DO UPDATE SET reason = excluded.reason, updated_at = CURRENT_TIMESTAMP
        `).run(conversationId, participantUid, reason || "Administrative moderation", user.uid);
        logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_RESTRICT_MESSAGING, ADMIN_TARGET_TYPES.CONVERSATION_USER, participantUid, { conversation_id: conversationId, target_uid: participantUid, reason });
      } else if (action === "unrestrict") {
        db.prepare(`DELETE FROM message_restrictions WHERE conversation_id = ? AND restricted_uid = ?`).run(conversationId, participantUid);
        logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_UNRESTRICT_MESSAGING, ADMIN_TARGET_TYPES.CONVERSATION_USER, participantUid, { conversation_id: conversationId, target_uid: participantUid, reason });
      } else if (action === "suspend" || action === "unsuspend") {
        const seller = db.prepare(`SELECT uid FROM sellers WHERE uid = ? LIMIT 1`).get(participantUid) as any;
        const organizer = db.prepare(`SELECT uid FROM event_creators WHERE uid = ? LIMIT 1`).get(participantUid) as any;
        const enabled = action === "suspend" ? 1 : 0;
        if (!seller && !organizer) return res.status(404).json({ error: "Participant account record not found" });
        if (seller) db.prepare(`UPDATE sellers SET is_suspended = ? WHERE uid = ?`).run(enabled, participantUid);
        if (organizer) db.prepare(`UPDATE event_creators SET status = ? WHERE uid = ?`).run(action === "suspend" ? "suspended" : "approved", participantUid);
        logAction(db, user, action === "suspend" ? ADMIN_ACTION_TYPES.ADMIN_SUSPEND_ACCOUNT : ADMIN_ACTION_TYPES.ADMIN_UNSUSPEND_ACCOUNT, seller ? ADMIN_TARGET_TYPES.SELLER : ADMIN_TARGET_TYPES.EVENT_CREATOR, participantUid, { conversation_id: conversationId, target_uid: participantUid, reason });
      } else if (action === "spam") {
        db.prepare(`UPDATE messages SET is_spam = 1, spam_flag_count = COALESCE(spam_flag_count, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE conversation_id = ?`).run(conversationId);
        const senderUids = [conversation.buyer_uid, conversation.seller_uid];
        for (const uid of senderUids) {
          db.prepare(`
            INSERT INTO sender_spam_profiles (uid, spam_score, spam_flags, last_flagged_at, created_at, updated_at)
            VALUES (?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(uid) DO UPDATE SET spam_score = spam_score + 1, spam_flags = spam_flags + 1, last_flagged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          `).run(uid);
        }
        logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_MARK_CONVERSATION_SPAM, ADMIN_TARGET_TYPES.CONVERSATION, String(conversationId), { conversation_id: conversationId, reason });
      } else if (action === "review_report" || action === "resolve_report" || action === "dismiss_report") {
        if (!Number.isInteger(reportId)) return res.status(400).json({ error: "report_id is required" });
        const report = db.prepare(`SELECT id, conversation_id, status FROM message_reports WHERE id = ? LIMIT 1`).get(reportId) as any;
        if (!report || Number(report.conversation_id) !== conversationId) return res.status(404).json({ error: "Report not found for conversation" });

        if (action === "review_report") {
          db.prepare(`UPDATE message_reports SET status = 'reviewed', reviewed_by_uid = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.uid, reportId);
          logAction(db, user, ADMIN_ACTION_TYPES.ADMIN_REVIEW_REPORT, ADMIN_TARGET_TYPES.MESSAGE_REPORT, String(reportId), { conversation_id: conversationId, report_id: reportId, reason });
        } else {
          const status = action === "resolve_report" ? "resolved" : "resolved";
          const finalResolution = resolution || (action === "dismiss_report" ? "Report dismissed" : "Report resolved");
          db.prepare(`
            UPDATE message_reports
            SET status = ?, resolution = ?, resolved_by_uid = ?, resolved_by_email = ?, resolved_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(status, finalResolution, user.uid, user.email ?? null, reportId);
          logAction(db, user, action === "resolve_report" ? ADMIN_ACTION_TYPES.ADMIN_RESOLVE_REPORT : ADMIN_ACTION_TYPES.ADMIN_DISMISS_REPORT, ADMIN_TARGET_TYPES.MESSAGE_REPORT, String(reportId), {
            conversation_id: conversationId,
            report_id: reportId,
            reason,
            resolution: finalResolution,
          });
        }
      } else {
        return res.status(400).json({ error: "Unsupported admin message action" });
      }

      return res.json({ success: true, conversation_id: conversationId, action });
    } catch (error) {
      console.error("Admin message moderation action error:", error);
      return res.status(500).json({ error: "Failed to apply moderation action" });
    }
  });

  return router;
}
