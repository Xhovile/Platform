import type { Express, Request, Response } from "express";
import { postgresDb as db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { ADMIN_ACTION_TYPES, ADMIN_TARGET_TYPES } from "../../src/modules/admin/shared/adminAuditTypes.js";

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.messageHubRoutesInstalled");
const MODERATION_ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.messageHubModerationRoutesInstalled");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER,
      event_id INTEGER,
      buyer_uid TEXT NOT NULL,
      seller_uid TEXT NOT NULL,
      last_message_preview TEXT,
      last_message_at DATETIME,
      buyer_unread_count INTEGER NOT NULL DEFAULT 0,
      seller_unread_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_listing_thread
    ON conversations (listing_id, buyer_uid, seller_uid)
    WHERE listing_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_event_thread
    ON conversations (event_id, buyer_uid, seller_uid)
    WHERE event_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_uid TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME,
      is_spam INTEGER NOT NULL DEFAULT 0,
      spam_flag_count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_uid TEXT NOT NULL,
      blocked_uid TEXT NOT NULL,
      block_scope TEXT NOT NULL DEFAULT 'messages',
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (blocker_uid, blocked_uid, block_scope)
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

    CREATE TABLE IF NOT EXISTS message_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER,
      message_id INTEGER,
      reporter_uid TEXT NOT NULL,
      reported_uid TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_by_uid TEXT,
      reviewed_at DATETIME,
      resolution TEXT,
      resolved_by_uid TEXT,
      resolved_by_email TEXT,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS sender_spam_profiles (
      uid TEXT PRIMARY KEY,
      spam_score INTEGER NOT NULL DEFAULT 0,
      spam_flags INTEGER NOT NULL DEFAULT 0,
      auto_limited_until DATETIME,
      last_flagged_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_spam INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS spam_flag_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS reviewed_by_uid TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS reviewed_at DATETIME;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolution TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolved_by_uid TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolved_by_email TEXT;
    ALTER TABLE message_reports ADD COLUMN IF NOT EXISTS resolved_at DATETIME;

    CREATE INDEX IF NOT EXISTS idx_message_reports_conversation
      ON message_reports (conversation_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_blocks_blocker
      ON message_blocks (blocker_uid, blocked_uid, block_scope);
    CREATE INDEX IF NOT EXISTS idx_message_blocks_blocked
      ON message_blocks (blocked_uid, blocker_uid, block_scope);
  `);
}

function getUser(req: Request) {
  return req.user as { uid: string; email: string | null; email_verified: boolean; is_admin: boolean } | undefined;
}

function parseConversationId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

function getConversation(conversationId: number) {
  return db
    .prepare(
      `SELECT id, listing_id, event_id, buyer_uid, seller_uid, last_message_preview, last_message_at,
              buyer_unread_count, seller_unread_count, created_at, updated_at
       FROM conversations
       WHERE id = ?
       LIMIT 1`
    )
    .get(conversationId) as
    | {
        id: number;
        listing_id: number;
        event_id: number | null;
        buyer_uid: string;
        seller_uid: string;
        last_message_preview: string | null;
        last_message_at: string | null;
        buyer_unread_count: number;
        seller_unread_count: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

function requireConversationAccess(conversation: ReturnType<typeof getConversation>, uid: string, isAdmin: boolean) {
  return !!conversation && (isAdmin || conversation.buyer_uid === uid || conversation.seller_uid === uid);
}

function resolveBlockTarget(conversation: NonNullable<ReturnType<typeof getConversation>>, uid: string) {
  if (conversation.buyer_uid === uid) return conversation.seller_uid;
  if (conversation.seller_uid === uid) return conversation.buyer_uid;
  return null;
}

function normalizeReason(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function normalizeDetails(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function incrementSpamProfile(uid: string) {
  db.prepare(
    `INSERT INTO sender_spam_profiles (uid, spam_score, spam_flags, last_flagged_at, created_at, updated_at)
     VALUES (?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(uid) DO UPDATE SET
       spam_score = spam_score + 1,
       spam_flags = spam_flags + 1,
       last_flagged_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  ).run(uid);
}

function registerConversationModerationRoutes(app: Express) {
  app.post("/api/messages/:conversationId/block", requireAuth, (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const conversationId = parseConversationId(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

    const conversation = getConversation(conversationId);
    if (!conversation || !requireConversationAccess(conversation, user.uid, user.is_admin)) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const blockedUid = resolveBlockTarget(conversation, user.uid);
    if (!blockedUid) return res.status(400).json({ error: "Unable to resolve block target" });

    const scope = typeof req.body?.scope === "string" && req.body.scope.trim() ? req.body.scope.trim() : "messages";
    const reason = normalizeReason(req.body?.reason);

    db.prepare(
      `INSERT INTO message_blocks (blocker_uid, blocked_uid, block_scope, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(blocker_uid, blocked_uid, block_scope) DO UPDATE SET
         reason = excluded.reason,
         updated_at = CURRENT_TIMESTAMP`
    ).run(user.uid, blockedUid, scope, reason || null);

    return res.json({ success: true, blocked_uid: blockedUid, block_scope: scope });
  });

  app.delete("/api/messages/:conversationId/block", requireAuth, (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const conversationId = parseConversationId(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

    const conversation = getConversation(conversationId);
    if (!conversation || !requireConversationAccess(conversation, user.uid, user.is_admin)) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const blockedUid = resolveBlockTarget(conversation, user.uid);
    if (!blockedUid) return res.status(400).json({ error: "Unable to resolve block target" });

    const scope = typeof req.body?.scope === "string" && req.body.scope.trim() ? req.body.scope.trim() : "messages";

    db.prepare(
      `DELETE FROM message_blocks
       WHERE blocker_uid = ? AND blocked_uid = ? AND block_scope = ?`
    ).run(user.uid, blockedUid, scope);

    return res.json({ success: true });
  });

  app.post("/api/messages/:conversationId/report", requireAuth, (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const conversationId = parseConversationId(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

    const conversation = getConversation(conversationId);
    if (!conversation || !requireConversationAccess(conversation, user.uid, user.is_admin)) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const reason = normalizeReason(req.body?.reason);
    const details = normalizeDetails(req.body?.details);
    if (!reason) return res.status(400).json({ error: "reason is required" });

    const reportedUid = resolveBlockTarget(conversation, user.uid);

    const result = db.prepare(
      `INSERT INTO message_reports (
         conversation_id, message_id, reporter_uid, reported_uid, reason, details, status, created_at, updated_at
       ) VALUES (?, NULL, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(conversationId, user.uid, reportedUid, reason, details || null);

    return res.status(201).json({
      success: true,
      id: Number(result.lastInsertRowid),
      conversation_id: conversationId,
      reported_uid: reportedUid,
      reason,
      details,
      status: "open",
    });
  });

  app.post("/api/messages/:conversationId/spam", requireAuth, (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const conversationId = parseConversationId(req.params.conversationId);
    if (!conversationId) return res.status(400).json({ error: "Invalid conversation id" });

    const conversation = getConversation(conversationId);
    if (!conversation || !requireConversationAccess(conversation, user.uid, user.is_admin)) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const messageId = req.body?.messageId === undefined ? null : Number(req.body.messageId);
    if (messageId !== null && !Number.isInteger(messageId)) {
      return res.status(400).json({ error: "Invalid messageId" });
    }

    const senderUid = messageId
      ? (db.prepare(`SELECT sender_uid FROM messages WHERE id = ? LIMIT 1`).get(messageId) as { sender_uid?: string } | undefined)?.sender_uid ?? null
      : resolveBlockTarget(conversation, user.uid);

    if (!senderUid) return res.status(400).json({ error: "Unable to resolve sender for spam flagging" });

    const messageUpdate = messageId
      ? db.prepare(
          `UPDATE messages
           SET is_spam = 1,
               spam_flag_count = COALESCE(spam_flag_count, 0) + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).run(messageId)
      : { changes: 0 };

    incrementSpamProfile(senderUid);

    return res.json({ success: true, messageId, sender_uid: senderUid, messageUpdated: messageUpdate.changes > 0 });
  });
}

function registerAdminMessageReportRoutes(app: Express) {
  app.get("/api/admin/message-reports", requireAuth, (req, res) => {
    const user = getUser(req);
    if (!user?.is_admin) return res.status(403).json({ error: "Admin access required" });

    const status = typeof req.query?.status === "string" && req.query.status.trim() ? req.query.status.trim() : "open";
    const conversationId = req.query?.conversation_id ? Number(req.query.conversation_id) : null;
    const statusFilter = ["open", "reviewed", "resolved", "all"].includes(status) ? status : "open";

    const rows = db.prepare(`
      SELECT
        mr.id, mr.conversation_id, mr.message_id, mr.reporter_uid, mr.reported_uid,
        mr.reason, mr.details, mr.status, mr.created_at, mr.updated_at,
        mr.reviewed_by_uid, mr.reviewed_at, mr.resolution, mr.resolved_by_uid,
        mr.resolved_by_email, mr.resolved_at,
        c.buyer_uid, c.seller_uid,
        l.name AS listing_name,
        sb.business_name AS seller_business_name,
        bb.business_name AS buyer_business_name,
        msg.body AS message_body
      FROM message_reports mr
      LEFT JOIN conversations c ON c.id = mr.conversation_id
      LEFT JOIN listings l ON l.id = c.listing_id
      LEFT JOIN sellers sb ON sb.uid = c.seller_uid
      LEFT JOIN sellers bb ON bb.uid = c.buyer_uid
      LEFT JOIN messages msg ON msg.id = mr.message_id
      WHERE (? = 'all' OR mr.status = ?)
        AND (? IS NULL OR mr.conversation_id = ?)
      ORDER BY mr.created_at DESC, mr.id DESC
    `).all(statusFilter, statusFilter, conversationId, conversationId) as Record<string, unknown>[];

    return res.json({ data: { items: rows } });
  });

  app.post("/api/admin/message-reports/:id/resolve", requireAuth, (req, res) => {
    const user = getUser(req);
    if (!user?.is_admin) return res.status(403).json({ error: "Admin access required" });

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid report id" });

    const existing = db.prepare(`SELECT id, conversation_id, status FROM message_reports WHERE id = ? LIMIT 1`).get(id) as { id?: number; conversation_id?: number | null; status?: string } | undefined;
    if (!existing) return res.status(404).json({ error: "Report not found" });

    const resolution = normalizeReason(req.body?.resolution) || "Report resolved";
    db.prepare(
      `UPDATE message_reports
       SET status = 'resolved',
           resolution = ?,
           resolved_by_uid = ?,
           resolved_by_email = ?,
           resolved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(resolution, user.uid, user.email ?? null, id);

    try {
      db.prepare(`
        INSERT INTO admin_actions (admin_uid, admin_email, action_type, target_id, details, target_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        user.uid,
        user.email ?? null,
        ADMIN_ACTION_TYPES.ADMIN_RESOLVE_REPORT,
        String(id),
        JSON.stringify({
          conversation_id: existing.conversation_id ?? null,
          report_id: id,
          resolution,
        }),
        ADMIN_TARGET_TYPES.MESSAGE_REPORT,
      );
    } catch (error) {
      console.warn("Failed to record message report resolution in admin audit", error);
    }

    const updated = db.prepare(`
      SELECT id, conversation_id, message_id, reporter_uid, reported_uid, reason, details, status,
             created_at, updated_at, reviewed_by_uid, reviewed_at, resolution,
             resolved_by_uid, resolved_by_email, resolved_at
      FROM message_reports
      WHERE id = ?
      LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;

    return res.json({ success: true, report: updated ?? { id, status: "resolved", resolution } });
  });
}

export function registerMessageRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;
  try {
    initSchema();
  } catch {
    // keep startup resilient if the compatibility DB cannot apply schema here
  }
  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}

export function registerMessageModerationRoutes(app: Express) {
  if ((app as any)[MODERATION_ROUTES_INSTALLED_FLAG]) return;

  try {
    initSchema();
  } catch {
    // keep startup resilient if the compatibility DB cannot apply schema here
  }

  registerConversationModerationRoutes(app);
  registerAdminMessageReportRoutes(app);
  (app as any)[MODERATION_ROUTES_INSTALLED_FLAG] = true;
}
