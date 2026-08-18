import type { Express, Request, Response } from "express";
import { postgresDb as db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.messagesRoutesInstalled");
let messagesSchemaEnsured = false;

type VerifiedRequestUser = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  is_admin: boolean;
};

type ConversationRow = {
  id: number;
  listing_id: number | null;
  event_id: number | null;
  buyer_uid: string;
  seller_uid: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  buyer_unread_count: number;
  seller_unread_count: number;
  created_at: string;
  updated_at: string;
  listing_name?: string | null;
  listing_price?: number | null;
  listing_status?: string | null;
  listing_photos?: string | null;
  listing_university?: string | null;
  event_title?: string | null;
  event_price?: number | null;
  event_status?: string | null;
  event_location?: string | null;
  event_type?: string | null;
  organizer_name?: string | null;
  seller_business_name?: string | null;
  seller_logo?: string | null;
  seller_is_verified?: number | null;
  buyer_business_name?: string | null;
  buyer_logo?: string | null;
  buyer_is_verified?: number | null;
};

type MessageRow = {
  id: number;
  conversation_id: number;
  sender_uid: string;
  body: string;
  is_read: number;
  created_at: string;
  read_at: string | null;
};

function ensureMessagesSchema() {
  if (messagesSchemaEnsured) return;

  try {
    db.pragma("foreign_keys = ON");

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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        sender_uid TEXT NOT NULL,
        body TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

    `);

    ensureConversationEventColumns();

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_listing
      ON conversations (listing_id, updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_listing_thread
      ON conversations (listing_id, buyer_uid, seller_uid)
      WHERE listing_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_event_thread
      ON conversations (event_id, buyer_uid, seller_uid)
      WHERE event_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_seller_thread
      ON conversations (buyer_uid, seller_uid)
      WHERE listing_id IS NULL AND event_id IS NULL;

      CREATE INDEX IF NOT EXISTS idx_conversations_buyer
      ON conversations (buyer_uid, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_conversations_seller
      ON conversations (seller_uid, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages (conversation_id, created_at ASC, id ASC);
    `);
    messagesSchemaEnsured = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Messages schema init skipped because the database is unavailable: ${message}`);
    messagesSchemaEnsured = true;
  }
}

function getUser(req: Request) {
  return req.user as VerifiedRequestUser | undefined;
}

function isAdmin(user?: VerifiedRequestUser | null) {
  return !!user?.is_admin;
}

function sanitizeBody(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 1000);
}

function requireConversationAccess(conversation: ConversationRow, user: VerifiedRequestUser) {
  return isAdmin(user) || conversation.buyer_uid === user.uid || conversation.seller_uid === user.uid;
}

function ensureConversationEventColumns() {
  try {
    const columns = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "event_id")) {
      db.exec(`ALTER TABLE conversations ADD COLUMN event_id INTEGER`);
    }
  } catch {
    // Best-effort migration for existing local SQLite databases.
  }
}

function getListingById(listingId: number) {
  return db
    .prepare(
      `SELECT l.id, l.seller_uid, l.name, l.price, l.status, l.photos, l.university, s.business_name, s.business_logo, s.is_verified
       FROM listings l
       JOIN sellers s ON s.uid = l.seller_uid
       WHERE l.id = ? AND l.is_hidden = 0 AND l.deleted_at IS NULL
       LIMIT 1`
    )
    .get(listingId) as
    | {
        id: number;
        seller_uid: string;
        name: string;
        price: number;
        status: string;
        photos: string | null;
        university: string;
        business_name: string | null;
        business_logo: string | null;
        is_verified: number | null;
      }
    | undefined;
}

function getSellerByUid(sellerUid: string) {
  return db
    .prepare(
      `SELECT uid, business_name, business_logo, is_verified
       FROM sellers
       WHERE uid = ?
       LIMIT 1`
    )
    .get(sellerUid) as
    | {
        uid: string;
        business_name: string | null;
        business_logo: string | null;
        is_verified: number | null;
      }
    | undefined;
}

function getEventById(eventId: number) {
  return db
    .prepare(
      `SELECT id, creator_uid, event_title, organizer_name, ticket_price, ticket_link, status, location, event_type
       FROM events
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`
    )
    .get(eventId) as
    | {
        id: number;
        creator_uid: string | null;
        event_title: string;
        organizer_name: string;
        ticket_price: number | null;
        ticket_link: string | null;
        status: string;
        location: string;
        event_type: string;
      }
    | undefined;
}

function getConversationById(conversationId: number) {
  return db
    .prepare(
      `SELECT
        c.*,
        l.name AS listing_name,
        l.price AS listing_price,
        l.status AS listing_status,
        l.photos AS listing_photos,
        l.university AS listing_university,
        e.event_title AS event_title,
        e.ticket_price AS event_price,
        e.status AS event_status,
        e.location AS event_location,
        e.event_type AS event_type,
        e.organizer_name AS organizer_name,
        sb.business_name AS seller_business_name,
        sb.business_logo AS seller_logo,
        sb.is_verified AS seller_is_verified,
        bb.business_name AS buyer_business_name,
        bb.business_logo AS buyer_logo,
        bb.is_verified AS buyer_is_verified
      FROM conversations c
      LEFT JOIN listings l ON l.id = c.listing_id
      LEFT JOIN events e ON e.id = c.event_id
      LEFT JOIN sellers sb ON sb.uid = c.seller_uid
      LEFT JOIN sellers bb ON bb.uid = c.buyer_uid
      WHERE c.id = ?
      LIMIT 1`
    )
    .get(conversationId) as ConversationRow | undefined;
}

function getConversationForEventThread(eventId: number, buyerUid: string, sellerUid: string) {
  return db
    .prepare(
      `SELECT *
       FROM conversations
       WHERE event_id = ? AND buyer_uid = ? AND seller_uid = ?
       LIMIT 1`
    )
    .get(eventId, buyerUid, sellerUid) as ConversationRow | undefined;
}

function getConversationForThread(listingId: number, buyerUid: string, sellerUid: string) {
  return db
    .prepare(
      `SELECT *
       FROM conversations
       WHERE listing_id = ? AND buyer_uid = ? AND seller_uid = ?
       LIMIT 1`
    )
    .get(listingId, buyerUid, sellerUid) as ConversationRow | undefined;
}

function getConversationForSellerThread(buyerUid: string, sellerUid: string) {
  return db
    .prepare(
      `SELECT *
       FROM conversations
       WHERE listing_id IS NULL
         AND event_id IS NULL
         AND buyer_uid = ?
         AND seller_uid = ?
       LIMIT 1`
    )
    .get(buyerUid, sellerUid) as ConversationRow | undefined;
}

function serializeConversation(conversation: ConversationRow) {
  const threadType = conversation.event_id ? "event" : conversation.listing_id ? "listing" : "seller";

  return {
    id: conversation.id,
    listing_id: conversation.listing_id,
    buyer_uid: conversation.buyer_uid,
    seller_uid: conversation.seller_uid,
    last_message_preview: conversation.last_message_preview,
    last_message_at: conversation.last_message_at,
    buyer_unread_count: Number(conversation.buyer_unread_count || 0),
    seller_unread_count: Number(conversation.seller_unread_count || 0),
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    thread_type: threadType,
    event_id: conversation.event_id,
    listing: {
      id: conversation.listing_id || 0,
      name:
        conversation.listing_name ||
        conversation.event_title ||
        conversation.seller_business_name ||
        "Conversation",
      price: Number(conversation.listing_price ?? conversation.event_price ?? 0),
      status: conversation.listing_status || conversation.event_status || "available",
      photos: (() => {
        try {
          return JSON.parse(conversation.listing_photos || "[]") as string[];
        } catch {
          return [] as string[];
        }
      })(),
      university: conversation.listing_university || conversation.event_location || "",
    },
    event: conversation.event_id
      ? {
          id: conversation.event_id,
          title: conversation.event_title || "Event",
          organizer_name: conversation.organizer_name || "Organizer",
          price: Number(conversation.event_price || 0),
          status: conversation.event_status || "published",
          location: conversation.event_location || "",
          type: conversation.event_type || "Event",
        }
      : null,
    seller: {
      uid: conversation.seller_uid,
      business_name: conversation.seller_business_name || "Seller",
      business_logo: conversation.seller_logo || null,
      is_verified: !!conversation.seller_is_verified,
    },
    buyer: {
      uid: conversation.buyer_uid,
      business_name: conversation.buyer_business_name || "Buyer",
      business_logo: conversation.buyer_logo || null,
      is_verified: !!conversation.buyer_is_verified,
    },
    unread_count: 0,
  };
}

function serializeThreadMessage(row: MessageRow) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_uid: row.sender_uid,
    body: row.body,
    is_read: !!row.is_read,
    created_at: row.created_at,
    read_at: row.read_at,
  };
}

function getMessages(conversationId: number) {
  return db
    .prepare(
      `SELECT *
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(conversationId) as MessageRow[];
}

function updateUnreadCounters(conversationId: number, senderUid: string, body: string) {
  const conversation = getConversationById(conversationId);
  if (!conversation) return;

  const isBuyer = conversation.buyer_uid === senderUid;
  const isSeller = conversation.seller_uid === senderUid;
  if (!isBuyer && !isSeller) return;

  if (isBuyer) {
    db.prepare(
      `UPDATE conversations
       SET seller_unread_count = seller_unread_count + 1,
           last_message_preview = ?,
           last_message_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(body.slice(0, 160), conversationId);
    return;
  }

  db.prepare(
    `UPDATE conversations
     SET buyer_unread_count = buyer_unread_count + 1,
         last_message_preview = ?,
         last_message_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(body.slice(0, 160), conversationId);
}

async function listInbox(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const sellerScope = String(req.query.scope || "").trim().toLowerCase() === "seller";
  const whereClause = sellerScope
    ? "c.seller_uid = ? AND c.listing_id IS NOT NULL"
    : "c.buyer_uid = ? OR c.seller_uid = ? OR ? = 1";
  const params = sellerScope
    ? [user.uid]
    : [user.uid, user.uid, user.is_admin ? 1 : 0];

  const rows = db
    .prepare(
      `SELECT
        c.*,
        l.name AS listing_name,
        l.price AS listing_price,
        l.status AS listing_status,
        l.photos AS listing_photos,
        l.university AS listing_university,
        e.event_title AS event_title,
        e.ticket_price AS event_price,
        e.status AS event_status,
        e.location AS event_location,
        e.event_type AS event_type,
        e.organizer_name AS organizer_name,
        sb.business_name AS seller_business_name,
        sb.business_logo AS seller_logo,
        sb.is_verified AS seller_is_verified,
        bb.business_name AS buyer_business_name,
        bb.business_logo AS buyer_logo,
        bb.is_verified AS buyer_is_verified
       FROM conversations c
       LEFT JOIN listings l ON l.id = c.listing_id
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN sellers sb ON sb.uid = c.seller_uid
       LEFT JOIN sellers bb ON bb.uid = c.buyer_uid
       WHERE ${whereClause}
       ORDER BY c.updated_at DESC, c.id DESC`
    )
    .all(...params) as ConversationRow[];

  res.json({
    items: rows.map((row) => ({
      ...serializeConversation(row),
      unread_count: row.buyer_uid === user.uid ? row.buyer_unread_count : row.seller_unread_count,
    })),
  });
}

async function getConversation(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const conversationId = Number(req.params.conversationId);
  if (!Number.isInteger(conversationId)) {
    return res.status(400).json({ error: "Invalid conversation id" });
  }

  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (!requireConversationAccess(conversation, user)) {
    return res.status(403).json({ error: "You cannot access this conversation" });
  }

  const messages = getMessages(conversationId).map(serializeThreadMessage);
  const payload = serializeConversation(conversation);

  res.json({
    conversation: {
      ...payload,
      unread_count: conversation.buyer_uid === user.uid ? conversation.buyer_unread_count : conversation.seller_unread_count,
    },
    messages,
  });
}

async function startConversationFromListing(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId)) {
    return res.status(400).json({ error: "Invalid listing id" });
  }

  const listing = getListingById(listingId);
  if (!listing) {
    return res.status(404).json({ error: "Listing not found" });
  }

  if (listing.seller_uid === user.uid && !user.is_admin) {
    return res.status(403).json({ error: "Sellers should reply from their inbox" });
  }

  const buyerUid = user.uid;
  const sellerUid = listing.seller_uid;
  const existing = getConversationForThread(listingId, buyerUid, sellerUid);
  if (existing) {
    return res.json({ conversation: serializeConversation(getConversationById(existing.id) || existing) });
  }

  const result = db
    .prepare(
      `INSERT INTO conversations (
        listing_id,
        buyer_uid,
        seller_uid,
        last_message_preview,
        last_message_at,
        buyer_unread_count,
        seller_unread_count,
        updated_at
      ) VALUES (?, ?, ?, NULL, NULL, 0, 0, CURRENT_TIMESTAMP)`
    )
    .run(listingId, buyerUid, sellerUid);

  const created = getConversationById(Number(result.lastInsertRowid));
  if (!created) {
    return res.status(500).json({ error: "Failed to create conversation" });
  }

  res.status(201).json({ conversation: serializeConversation(created) });
}

async function startConversationFromEvent(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const eventId = Number(req.params.eventId);
  if (!Number.isInteger(eventId)) {
    return res.status(400).json({ error: "Invalid event id" });
  }

  const event = getEventById(eventId);
  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }

  if (!event.creator_uid) {
    return res.status(400).json({ error: "Event owner is unavailable" });
  }

  if (event.creator_uid === user.uid && !user.is_admin) {
    return res.status(403).json({ error: "Event owners should reply from their inbox" });
  }

  const buyerUid = user.uid;
  const sellerUid = event.creator_uid;
  const existing = getConversationForEventThread(eventId, buyerUid, sellerUid);
  if (existing) {
    return res.json({ conversation: serializeConversation(getConversationById(existing.id) || existing) });
  }

  const result = db
    .prepare(
      `INSERT INTO conversations (
        listing_id,
        event_id,
        buyer_uid,
        seller_uid,
        last_message_preview,
        last_message_at,
        buyer_unread_count,
        seller_unread_count,
        updated_at
      ) VALUES (NULL, ?, ?, ?, NULL, NULL, 0, 0, CURRENT_TIMESTAMP)`
    )
    .run(eventId, buyerUid, sellerUid);

  const created = getConversationById(Number(result.lastInsertRowid));
  if (!created) {
    return res.status(500).json({ error: "Failed to create conversation" });
  }

  res.status(201).json({ conversation: serializeConversation(created) });
}

async function startConversationWithSeller(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const sellerUid = String(req.params.sellerUid || "").trim();
  if (!sellerUid) {
    return res.status(400).json({ error: "Invalid seller id" });
  }

  if (sellerUid === user.uid && !user.is_admin) {
    return res.status(403).json({ error: "Sellers cannot message themselves" });
  }

  const seller = getSellerByUid(sellerUid);
  if (!seller) {
    return res.status(404).json({ error: "Seller not found" });
  }

  const buyerUid = user.uid;
  const existing = getConversationForSellerThread(buyerUid, sellerUid);
  if (existing) {
    return res.json({ conversation: serializeConversation(getConversationById(existing.id) || existing) });
  }

  const result = db
    .prepare(
      `INSERT INTO conversations (
        listing_id,
        event_id,
        buyer_uid,
        seller_uid,
        last_message_preview,
        last_message_at,
        buyer_unread_count,
        seller_unread_count,
        updated_at
      ) VALUES (NULL, NULL, ?, ?, NULL, NULL, 0, 0, CURRENT_TIMESTAMP)`
    )
    .run(buyerUid, sellerUid);

  const created = getConversationById(Number(result.lastInsertRowid));
  if (!created) {
    return res.status(500).json({ error: "Failed to create seller conversation" });
  }

  res.status(201).json({ conversation: serializeConversation(created) });
}

async function sendMessage(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const conversationId = Number(req.params.conversationId);
  if (!Number.isInteger(conversationId)) {
    return res.status(400).json({ error: "Invalid conversation id" });
  }

  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (!requireConversationAccess(conversation, user)) {
    return res.status(403).json({ error: "You cannot reply in this conversation" });
  }

  const body = sanitizeBody((req.body as any)?.body);
  if (!body) {
    return res.status(400).json({ error: "Message cannot be empty" });
  }

  const result = db
    .prepare(
      `INSERT INTO messages (conversation_id, sender_uid, body, is_read, read_at)
       VALUES (?, ?, ?, 0, NULL)`
    )
    .run(conversationId, user.uid, body);

  db.prepare(
    `UPDATE messages
     SET is_read = 1,
         read_at = CURRENT_TIMESTAMP
     WHERE id = ? AND sender_uid = ?`
  ).run(Number(result.lastInsertRowid), user.uid);

  updateUnreadCounters(conversationId, user.uid, body);

  const message = db
    .prepare(`SELECT * FROM messages WHERE id = ? LIMIT 1`)
    .get(Number(result.lastInsertRowid)) as MessageRow | undefined;

  const updatedConversation = getConversationById(conversationId);
  if (!message || !updatedConversation) {
    return res.status(500).json({ error: "Failed to send message" });
  }

  res.status(201).json({
    success: true,
    conversation: {
      ...serializeConversation(updatedConversation),
      unread_count: updatedConversation.buyer_uid === user.uid ? updatedConversation.buyer_unread_count : updatedConversation.seller_unread_count,
    },
    message: serializeThreadMessage(message),
  });
}

async function markRead(req: Request, res: Response) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const conversationId = Number(req.params.conversationId);
  if (!Number.isInteger(conversationId)) {
    return res.status(400).json({ error: "Invalid conversation id" });
  }

  const conversation = getConversationById(conversationId);
  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (!requireConversationAccess(conversation, user)) {
    return res.status(403).json({ error: "You cannot access this conversation" });
  }

  const senderUid = conversation.buyer_uid === user.uid ? conversation.seller_uid : conversation.buyer_uid;
  db.prepare(
    `UPDATE messages
     SET is_read = 1,
         read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE conversation_id = ? AND sender_uid = ?`
  ).run(conversationId, senderUid);

  if (conversation.buyer_uid === user.uid) {
    db.prepare(
      `UPDATE conversations
       SET buyer_unread_count = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(conversationId);
  } else {
    db.prepare(
      `UPDATE conversations
       SET seller_unread_count = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(conversationId);
  }

  const updated = getConversationById(conversationId);
  res.json({
    success: true,
    conversation: updated ? { ...serializeConversation(updated), unread_count: updated.buyer_uid === user.uid ? updated.buyer_unread_count : updated.seller_unread_count } : null,
  });
}

export function registerMessagesRoutes(app: Express) {
  ensureMessagesSchema();
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.get("/api/messages/inbox", requireAuth, (req, res) => void listInbox(req, res));
  app.get("/api/messages/:conversationId", requireAuth, (req, res) => void getConversation(req, res));
  app.post("/api/listings/:listingId/messages/start", requireAuth, (req, res) => void startConversationFromListing(req, res));
  app.post("/api/events/:eventId/messages/start", requireAuth, (req, res) => void startConversationFromEvent(req, res));
  app.post("/api/sellers/:sellerUid/messages/start", requireAuth, (req, res) => void startConversationWithSeller(req, res));
  app.post("/api/messages/:conversationId/messages", requireAuth, (req, res) => void sendMessage(req, res));
  app.post("/api/messages/:conversationId/read", requireAuth, (req, res) => void markRead(req, res));

  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}
