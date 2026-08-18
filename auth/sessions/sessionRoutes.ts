import type { Express, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { hasAdminAccess } from "./adminAccess.js";
import { revokeTotpVerifiedSessions } from "../../src/server/totpStoreCompat.js";
import { getPaymentDb } from "../postgresCompat.js";
import { orderRepository } from "../modules/orders/order.repository.js";
import { paymentRepository } from "../modules/payments/payment.repository.js";
import { requireCanonicalIdentity } from "./canonicalAuth.js";

type VerifiedRequestUser = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  is_admin: boolean;
};

type ValidatorAccessScope = {
  can_validate_tickets: boolean;
  is_admin: boolean;
  role: "admin" | "validator";
  source: "buymesho";
  allowed_event_ids: string[];
  snapshot_version: string | null;
};

type EventRow = {
  id: number;
  creator_uid: string | null;
  event_type: string;
  event_title: string;
  organizer_name: string;
  event_date: string;
  start_time: string;
  venue: string;
  location: string;
  ticket_mode: string;
  ticket_price: number | null;
  ticket_link: string | null;
  description: string;
  contact_whatsapp: string | null;
  poster_alt: string | null;
  spec_values: string;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventCreatorRow = { uid: string; email: string; display_name: string; organization_name: string; organization_type: string; contact_whatsapp: string | null; event_types: string; status: string; active_until: string | null; approved_at: string | null; created_at: string; updated_at: string };

type ValidatorEvent = {
  id: string;
  creator_uid: string | null;
  event_type: string;
  event_title: string;
  organizer_name: string;
  event_date: string;
  start_time: string;
  venue: string;
  location: string;
  ticket_mode: string;
  ticket_price: number | null;
  ticket_link: string | null;
  description: string;
  contact_whatsapp: string | null;
  poster_alt: string | null;
  spec_values: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
  version: string;
  ticket_count: number;
};

type ValidatorTicket = {
  id: string;
  code: string;
  event_id: string;
  event_title: string;
  order_id: string;
  buyer_id: string;
  status: "Waiting Entry" | "Inside" | "Outside" | "Cancelled" | "Refunded" | "Blocked" | "Duplicate Scan Attempt";
  order_status: string;
  payment_status: string | null;
  updated_at: string;
  version: string;
  metadata: Record<string, unknown>;
};

const ROUTES_INSTALLED_FLAG = Symbol.for("buymesho.sessionRoutesInstalled");

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown): string | null {
  const text = normalizeString(value);
  return text.length > 0 ? text : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeParseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isEventCreatorActive(row: EventCreatorRow | undefined) {
  if (!row || row.status !== "approved") return false;
  if (!row.active_until) return true;
  return new Date(row.active_until).getTime() >= Date.now();
}

function loadValidatorEvents(uid: string): ValidatorEvent[] {
  const db = getPaymentDb();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM events
        WHERE creator_uid = ?
          AND deleted_at IS NULL
        ORDER BY updated_at DESC, created_at DESC, id DESC
      `,
    )
    .all(uid) as EventRow[];

  const ticketCounts = new Map<number, number>();
  const allOrders = db
    .prepare(
      `
        SELECT id
        FROM orders
        ORDER BY updated_at DESC, created_at DESC
      `,
    )
    .all() as Array<{ id: string }>;

  for (const orderRef of allOrders) {
    const order = orderRepository.findById(orderRef.id);
    if (!order) continue;

    for (const item of order.items ?? []) {
      const eventId = typeof item.eventId === "string" ? Number(item.eventId) : Number.NaN;
      if (!Number.isInteger(eventId)) continue;
      if (order.status === "draft" || order.status === "pending_payment") continue;
      ticketCounts.set(eventId, (ticketCounts.get(eventId) ?? 0) + (Number(item.quantity) || 1));
    }
  }

  return rows.map((row) => ({
    id: String(row.id),
    creator_uid: row.creator_uid,
    event_type: row.event_type,
    event_title: row.event_title,
    organizer_name: row.organizer_name,
    event_date: row.event_date,
    start_time: row.start_time,
    venue: row.venue,
    location: row.location,
    ticket_mode: row.ticket_mode,
    ticket_price: row.ticket_price === null || row.ticket_price === undefined ? null : Number(row.ticket_price),
    ticket_link: row.ticket_link,
    description: row.description,
    contact_whatsapp: row.contact_whatsapp,
    poster_alt: row.poster_alt,
    spec_values: safeParseJsonObject(row.spec_values),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.updated_at,
    ticket_count: ticketCounts.get(row.id) ?? 0,
  }));
}

function loadCreatorRecord(uid: string) {
  const db = getPaymentDb();
  return db
    .prepare(
      `
        SELECT *
        FROM event_creators
        WHERE uid = ?
        LIMIT 1
      `,
    )
    .get(uid) as EventCreatorRow | undefined;
}

function buildValidatorAccessScope(user: VerifiedRequestUser, events: ValidatorEvent[]): ValidatorAccessScope {
  const isAdmin = hasAdminAccess({ email: user.email, uid: user.uid, is_admin: user.is_admin });

  return {
    can_validate_tickets: true,
    is_admin: isAdmin,
    role: isAdmin ? "admin" : "validator",
    source: "buymesho",
    allowed_event_ids: events.map((event) => event.id),
    snapshot_version: events.length > 0 ? events[0].version : null,
  };
}

function mapOrderStatusToTicketStatus(orderStatus: string, paymentStatus: string | null) {
  const status = orderStatus.toLowerCase();
  const payment = (paymentStatus ?? "").toLowerCase();

  if (status === "refunded" || payment === "refunded") return "Refunded" as const;
  if (status === "cancelled") return "Cancelled" as const;
  if (status === "disputed" || status === "closed") return "Blocked" as const;
  if (status === "fulfilled") return "Inside" as const;
  if (status === "in_escrow") return "Outside" as const;
  return "Waiting Entry" as const;
}

function normalizeTicketCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function buildTicketSnapshotsForEvent(uid: string, eventId: string): { event: ValidatorEvent; tickets: ValidatorTicket[] } | null {
  const events = loadValidatorEvents(uid);
  const event = events.find((entry) => entry.id === eventId);
  if (!event) return null;

  const allOrders = getPaymentDb()
    .prepare(
      `
        SELECT id
        FROM orders
        ORDER BY updated_at DESC, created_at DESC
      `,
    )
    .all() as Array<{ id: string }>;

  const tickets: ValidatorTicket[] = [];

  for (const orderRef of allOrders) {
    const order = orderRepository.findById(orderRef.id);
    if (!order) continue;
    const payment = order.paymentReference ? paymentRepository.findByReference(order.paymentReference) ?? null : null;

    for (const item of order.items ?? []) {
      const itemEventId = typeof item.eventId === "string" ? item.eventId : null;
      if (itemEventId !== event.id) continue;

      const quantity = Math.max(1, Number(item.quantity) || 1);
      const codeSeed = normalizeString(item.reference ?? order.paymentReference ?? `${order.id}-${item.title}`);
      const codeBase = normalizeTicketCode(codeSeed || `${order.id}-${event.id}`);

      for (let index = 0; index < quantity; index += 1) {
        const ticketId = `${order.id}:${event.id}:${index + 1}`;
        const updatedAt = payment?.updatedAt ?? order.updatedAt ?? event.updated_at;
        tickets.push({
          id: ticketId,
          code: `${codeBase}${quantity > 1 ? `-${index + 1}` : ""}`,
          event_id: event.id,
          event_title: event.event_title,
          order_id: order.id,
          buyer_id: order.buyerId,
          status: mapOrderStatusToTicketStatus(order.status, payment?.status ?? null),
          order_status: order.status,
          payment_status: payment?.status ?? null,
          updated_at: updatedAt,
          version: updatedAt,
          metadata: {
            item_title: item.title,
            quantity: 1,
            unit_price: item.unitPrice ?? null,
            order_total: order.total,
            paid_at: order.paidAt ?? payment?.paidAt ?? null,
            fulfilled_at: order.fulfilledAt ?? null,
            payment_reference: order.paymentReference ?? payment?.reference ?? null,
            event_version: event.version,
            organizer_name: event.organizer_name,
            venue: event.venue,
            location: event.location,
          },
        });
      }
    }
  }

  return { event, tickets };
}

function validatorMeHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const creator = loadCreatorRecord(user.uid);
  if (!isEventCreatorActive(creator)) {
    return res.status(403).json({ error: "Approved event creator access is required" });
  }

  const events = loadValidatorEvents(user.uid);
  const scope = buildValidatorAccessScope(user, events);

  return res.json({
    success: true,
    identity: {
      uid: user.uid,
      email: user.email,
      email_verified: user.email_verified,
      is_admin: user.is_admin,
      display_name: creator?.display_name ?? creator?.organization_name ?? null,
    },
    creator: creator
      ? {
          uid: creator.uid,
          email: creator.email,
          display_name: creator.display_name,
          organization_name: creator.organization_name,
          organization_type: creator.organization_type,
          contact_whatsapp: creator.contact_whatsapp,
          event_types: creator.event_types,
          status: creator.status,
          active_until: creator.active_until,
          approved_at: creator.approved_at,
          created_at: creator.created_at,
          updated_at: creator.updated_at,
        }
      : null,
    access_scope: scope,
    events,
  });
}

function validatorEventsHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const creator = loadCreatorRecord(user.uid);
  if (!isEventCreatorActive(creator)) {
    return res.status(403).json({ error: "Approved event creator access is required" });
  }

  return res.json({
    success: true,
    events: loadValidatorEvents(user.uid),
  });
}

function validatorEventTicketsHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const creator = loadCreatorRecord(user.uid);
  if (!isEventCreatorActive(creator)) {
    return res.status(403).json({ error: "Approved event creator access is required" });
  }

  const eventId = normalizeString(req.params.eventId);
  const bundle = buildTicketSnapshotsForEvent(user.uid, eventId);
  if (!bundle) {
    return res.status(404).json({ error: "Event not found" });
  }

  return res.json({
    success: true,
    event: bundle.event,
    tickets: bundle.tickets,
    snapshot_version: bundle.event.version,
  });
}

function validatorResolveTicketHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const creator = loadCreatorRecord(user.uid);
  if (!isEventCreatorActive(creator)) {
    return res.status(403).json({ error: "Approved event creator access is required" });
  }

  const code = normalizeTicketCode(normalizeString(req.query.code));
  if (!code) {
    return res.status(400).json({ error: "Missing ticket code" });
  }

  const events = loadValidatorEvents(user.uid);
  for (const event of events) {
    const bundle = buildTicketSnapshotsForEvent(user.uid, event.id);
    if (!bundle) continue;
    const ticket = bundle.tickets.find((entry) => normalizeTicketCode(entry.code) === code || normalizeTicketCode(entry.id) === code);
    if (ticket) {
      return res.json({
        success: true,
        event: bundle.event,
        ticket,
        matched_on: code,
      });
    }
  }

  return res.status(404).json({ error: "Ticket not found" });
}

async function revokeSessionsHandler(req: Request, res: Response) {
  const user = req.user as VerifiedRequestUser | undefined;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const admin = getFirebaseAdmin();
    await admin.auth().revokeRefreshTokens(user.uid);
    revokeTotpVerifiedSessions(user.uid);

    return res.json({
      success: true,
      message: "All sessions have been revoked.",
    });
  } catch (error) {
    console.error("Failed to revoke sessions:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to revoke sessions",
    });
  }
}

export function registerSessionRoutes(app: Express) {
  if ((app as any)[ROUTES_INSTALLED_FLAG]) return;

  app.get("/api/auth/validator/me", requireCanonicalIdentity, validatorMeHandler);
  app.get("/api/validator/me", requireCanonicalIdentity, validatorMeHandler);
  app.get("/api/validator/events", requireCanonicalIdentity, validatorEventsHandler);
  app.get("/api/validator/events/:eventId/tickets", requireCanonicalIdentity, validatorEventTicketsHandler);
  app.get("/api/validator/tickets/resolve", requireCanonicalIdentity, validatorResolveTicketHandler);
  app.post("/api/auth/revoke-sessions", requireCanonicalIdentity, revokeSessionsHandler);

  (app as any)[ROUTES_INSTALLED_FLAG] = true;
}
