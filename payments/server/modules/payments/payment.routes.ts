import express, { type RequestHandler } from "express";
import { createHash, randomUUID } from "crypto";
import rateLimit from "express-rate-limit";
import { serverPaymentService } from "./payment.service.js";
import { serverOrderService } from "../orders/order.service.js";
import { orderRepository } from "../orders/order.repository.js";
import { paymentRepository } from "./payment.repository.js";
import { escrowRepository } from "../escrow/escrow.repository.js";
import { getPaymentDb } from "../../postgresCompat.js";
import { calculateCustomerCheckoutFees } from "../payouts/payout.policy.js";
import { paymentWebhookHandler } from "./payment.webhooks.js";
import { payoutWebhookHandler } from "../payouts/payout.webhooks.js";

export { payoutWebhookHandler };

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout requests. Please try again in a moment." },
});

const orderLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many order lookup requests. Please try again in a moment." },
});

type ListingRow = {
  id: number;
  seller_uid: string;
  name: string;
  price: number;
  status: string;
  quantity: number;
  sold_quantity: number;
};

type EventRow = {
  id: number;
  creator_uid: string | null;
  event_title: string;
  ticket_price: number | null;
  ticket_link: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  location: string | null;
  organizer_name: string | null;
  status: string;
};

type CheckoutItemInput = {
  listingId?: unknown;
  eventId?: unknown;
  quantity?: unknown;
};

type TicketHolderInput = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
};

type OrderBundle = {
  order: ReturnType<typeof orderRepository.findById>;
  payment: ReturnType<typeof paymentRepository.findByReference> | null;
  escrow: ReturnType<typeof escrowRepository.findByOrderId> | null;
  dispute: Record<string, unknown> | null;
};

function jsonError(error: unknown, fallback: string) {
  return { error: error instanceof Error ? error.message : fallback };
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function findOrderByParam(param: string) {
  return orderRepository.findById(param) ?? orderRepository.findByPaymentReference(param);
}

function buildOrderBundle(orderId: string): OrderBundle | null {
  const order = orderRepository.findById(orderId);
  if (!order) return null;

  const db: any = getPaymentDb();
  const payment = order.paymentReference ? paymentRepository.findByReference(order.paymentReference) : null;
  const escrow = escrowRepository.findByOrderId(order.id) ?? null;
  const dispute = db.prepare("SELECT * FROM disputes WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").get(order.id) ?? null;

  return { order, payment, escrow, dispute };
}

function resolvePublicPaymentState(reference: string) {
  const normalizedReference = reference.trim();
  const payment = paymentRepository.findByReference(normalizedReference);
  const order =
    orderRepository.findByPaymentReference(normalizedReference) ??
    (payment ? orderRepository.findById(payment.orderId) : undefined) ??
    orderRepository.findById(normalizedReference);
  const escrow = order ? escrowRepository.findByOrderId(order.id) ?? null : null;

  return { reference: payment?.reference ?? order?.paymentReference ?? normalizedReference, payment, order, escrow };
}

function buildPublicPaymentStatus(reference: string) {
  const { payment, order, escrow, reference: resolvedReference } = resolvePublicPaymentState(reference);
  return {
    success: true,
    reference: resolvedReference,
    orderId: order?.id ?? payment?.orderId ?? null,
    orderStatus: order?.status ?? null,
    paymentStatus: payment?.status ?? null,
    paymentVerified: Boolean(payment?.verified),
    escrowStatus: escrow?.state ?? null,
  };
}

function createPublicTicketId() {
  return `BM-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function normalizeTicketHolder(input: TicketHolderInput | undefined) {
  const fullName = typeof input?.fullName === "string" ? input.fullName.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const phone = typeof input?.phone === "string" ? input.phone.trim() : "";
  return { fullName, email, phone };
}

function validateTicketHolder(holder: ReturnType<typeof normalizeTicketHolder>) {
  if (holder.fullName.length < 2) return "Ticket holder full name is required";
  if (!/^\S+@\S+\.\S+$/.test(holder.email)) return "A valid ticket holder email is required";
  if (holder.phone.length < 7) return "A valid ticket holder phone number is required";
  return null;
}

function normalizeIdempotencyKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCheckoutRequestHash(input: {
  requestedItems: CheckoutItemInput[];
  method: unknown;
  settlementRoute: unknown;
  returnUrl: unknown;
  cancelUrl: unknown;
  buyerName: unknown;
  buyerPhone: unknown;
  ticketHolder: ReturnType<typeof normalizeTicketHolder>;
}): string {
  const normalized = {
    requestedItems: input.requestedItems.map((item) => ({
      listingId: item.listingId == null ? null : String(item.listingId),
      eventId: item.eventId == null ? null : String(item.eventId),
      quantity: Number(item.quantity ?? 1),
    })),
    method: String(input.method ?? "mobile_money"),
    settlementRoute: String(input.settlementRoute ?? "escrow"),
    returnUrl: String(input.returnUrl ?? ""),
    cancelUrl: String(input.cancelUrl ?? ""),
    buyerName: String(input.buyerName ?? ""),
    buyerPhone: String(input.buyerPhone ?? ""),
    ticketHolder: input.ticketHolder,
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function idempotentCheckoutResponse(order: ReturnType<typeof orderRepository.findById>) {
  if (!order) return null;
  const payment = order.paymentReference ? paymentRepository.findByReference(order.paymentReference) : null;
  if (!payment) {
    return {
      status: 409,
      body: {
        error: "This checkout is already being initialized. Please continue with the existing checkout.",
        code: "CHECKOUT_IN_PROGRESS",
        orderId: order.id,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      idempotentReplay: true,
      orderId: order.id,
      paymentId: payment.id,
      reference: payment.reference,
      checkoutUrl: payment.checkoutUrl ?? null,
      payment,
      order,
      totals: {
        subtotal: order.subtotal.amount,
        total: order.total.amount,
        fees: Math.max(0, Number(order.total.amount) - Number(order.subtotal.amount)),
      },
    },
  };
}

export function createPaymentRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();

  router.post("/checkout", checkoutLimiter, requireAuth, async (req: any, res) => {
    try {
      const body = req.body ?? {};
      const listingId = body.listingId;
      const quantity = body.quantity ?? 1;
      const items = Array.isArray(body.items) ? (body.items as CheckoutItemInput[]) : [];
      const method = body.method ?? "mobile_money";
      const settlementRoute = body.settlementRoute ?? "escrow";
      const returnUrl = body.returnUrl;
      const cancelUrl = body.cancelUrl;
      const buyerName = body.buyerName;
      const buyerPhone = body.buyerPhone;
      const ticketHolder = normalizeTicketHolder(body.ticketHolder as TicketHolderInput | undefined);
      const idempotencyKey = normalizeIdempotencyKey(req.headers["idempotency-key"] ?? body.idempotencyKey);
      const hasLegacyListingId = listingId !== undefined && listingId !== null && String(listingId).trim() !== "";
      const requestedItems: CheckoutItemInput[] = items.length > 0 ? items : (hasLegacyListingId ? [{ listingId, quantity }] : []);

      if (requestedItems.length === 0) {
        return res.status(400).json({ error: "listingId or items are required" });
      }

      if (!idempotencyKey) {
        return res.status(400).json({ error: "Idempotency-Key header is required for checkout", code: "IDEMPOTENCY_KEY_REQUIRED" });
      }

      if (idempotencyKey.length > 200) {
        return res.status(400).json({ error: "Idempotency-Key is too long", code: "INVALID_IDEMPOTENCY_KEY" });
      }

      const containsEventTicket = requestedItems.some((item) => item?.eventId !== undefined && item?.eventId !== null && String(item.eventId).trim() !== "");
      if (containsEventTicket) {
        const holderError = validateTicketHolder(ticketHolder);
        if (holderError) return res.status(400).json({ error: holderError });
      }

      const buyerUid = req.user.uid;
      const requestHash = buildCheckoutRequestHash({
        requestedItems,
        method,
        settlementRoute,
        returnUrl,
        cancelUrl,
        buyerName,
        buyerPhone,
        ticketHolder,
      });

      const existingOrder = orderRepository.findByCheckoutIdempotencyKey(buyerUid, idempotencyKey);
      if (existingOrder) {
        if (existingOrder.checkoutRequestHash && existingOrder.checkoutRequestHash !== requestHash) {
          return res.status(409).json({
            error: "This Idempotency-Key was already used for a different checkout request.",
            code: "IDEMPOTENCY_KEY_REUSED",
          });
        }

        const replay = idempotentCheckoutResponse(existingOrder);
        if (replay) return res.status(replay.status).json(replay.body);
      }

      const db: any = getPaymentDb();
      const currency = "MWK";
      const now = new Date().toISOString();
      const buyerEmail = req.user.email ?? "";
      const orderId = `ord_${randomUUID()}`;
      const orderItems: any[] = [];
      const listingIds: string[] = [];
      const eventIds: string[] = [];
      const eventDetails: Array<Record<string, unknown>> = [];
      const sellerIds = new Set<string>();
      let total = 0;
      let hasListing = false;
      let hasEvent = false;

      for (const item of requestedItems) {
        const rawListingId = item.listingId;
        const rawEventId = item.eventId;
        const hasItemListingId = rawListingId !== undefined && rawListingId !== null && String(rawListingId).trim() !== "";
        const hasItemEventId = rawEventId !== undefined && rawEventId !== null && String(rawEventId).trim() !== "";

        if (!hasItemListingId && !hasItemEventId) {
          return res.status(400).json({ error: "Each checkout item requires a listingId or eventId" });
        }
        if (hasItemListingId && hasItemEventId) {
          return res.status(400).json({ error: "A checkout item cannot contain both a listingId and eventId" });
        }

        const parsedQty = Number(item.quantity ?? 1);
        if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
          return res.status(400).json({ error: "Invalid quantity for checkout item" });
        }

        const safeQty = Math.max(1, Math.floor(parsedQty));

        if (hasItemEventId) {
          const eventId = Number(rawEventId);
          if (!Number.isInteger(eventId) || eventId <= 0) {
            return res.status(400).json({ error: `Invalid eventId ${String(rawEventId)}` });
          }

          const event = db.prepare("SELECT * FROM events WHERE id = ? AND deleted_at IS NULL").get(eventId) as EventRow | undefined;
          if (!event) {
            return res.status(404).json({ error: `Event ${eventId} not found` });
          }

          if (String(event.status ?? "").toLowerCase() !== "published") {
            return res.status(400).json({ error: `${event.event_title} is not available for checkout` });
          }

          const unitPrice = Number(event.ticket_price ?? 0);
          total += unitPrice * safeQty;
          hasEvent = true;
          eventIds.push(String(event.id));
          eventDetails.push({
            eventId: String(event.id),
            title: event.event_title,
            organizerName: event.organizer_name ?? "Event organizer",
            eventDate: event.event_date ?? "",
            startTime: event.start_time ?? "",
            venue: event.venue ?? "",
            location: event.location ?? "",
            ticketPrice: unitPrice,
            ticketLink: event.ticket_link ?? null,
            quantity: safeQty,
          });
          sellerIds.add(String(event.creator_uid ?? `event:${event.id}`));

          const ticketRecords = Array.from({ length: safeQty }, () => ({
            ticketId: createPublicTicketId(),
            holder: {
              fullName: ticketHolder.fullName,
              email: ticketHolder.email,
              phone: ticketHolder.phone,
            },
            status: "pending",
          }));

          orderItems.push({
            kind: "event_ticket",
            eventId: String(event.id),
            title: event.event_title,
            organizerName: event.organizer_name ?? "Event organizer",
            eventDate: event.event_date ?? "",
            startTime: event.start_time ?? "",
            venue: event.venue ?? "",
            location: event.location ?? "",
            ticketLink: event.ticket_link ?? null,
            ticketType: "General Admission",
            quantity: safeQty,
            unitPrice: { amount: unitPrice, currency },
            ticketId: ticketRecords[0]?.ticketId ?? createPublicTicketId(),
            ticketHolder: ticketRecords[0]?.holder ?? ticketHolder,
            tickets: ticketRecords,
            reference: `${orderId}-EVENT-${String(orderItems.length + 1).padStart(2, "0")}`,
          });
          continue;
        }

        const numericListingId = Number(rawListingId);
        if (!Number.isInteger(numericListingId) || numericListingId <= 0) {
          return res.status(400).json({ error: "Each checkout item requires a valid listingId" });
        }

        const listing = db.prepare("SELECT * FROM listings WHERE id = ? AND is_hidden = 0 AND deleted_at IS NULL").get(numericListingId) as ListingRow | undefined;
        if (!listing) {
          return res.status(404).json({ error: `Listing ${numericListingId} not found` });
        }

        if (listing.status === "sold") {
          return res.status(400).json({ error: `${listing.name} is no longer available` });
        }

        const availableQty = Math.max(0, Number(listing.quantity ?? 1) - Number(listing.sold_quantity ?? 0));
        if (availableQty === 0) return res.status(400).json({ error: `${listing.name} is out of stock` });
        if (safeQty > availableQty) return res.status(400).json({ error: `Only ${availableQty} unit(s) available for ${listing.name}` });

        const unitPrice = Number(listing.price);
        total += unitPrice * safeQty;
        hasListing = true;
        sellerIds.add(listing.seller_uid);
        listingIds.push(String(numericListingId));
        orderItems.push({
          kind: "listing",
          listingId: String(numericListingId),
          title: listing.name,
          quantity: safeQty,
          unitPrice: { amount: unitPrice, currency },
          reference: `${orderId}-ITEM-${String(orderItems.length + 1).padStart(2, "0")}`,
        });
      }

      const source = hasListing && hasEvent ? "mixed" : hasEvent ? "event" : "listing";
      const primarySellerId = sellerIds.values().next().value ?? "multiple-sellers";
      const feeBreakdown = calculateCustomerCheckoutFees({ itemTotalAmount: total, currency });

      try {
        serverOrderService.create({
          id: orderId,
          buyerId: buyerUid,
          sellerId: primarySellerId,
          source,
          status: "pending_payment",
          currency,
          subtotal: { amount: total, currency },
          total: { amount: feeBreakdown.finalTotalAmount, currency },
          paymentProvider: "paychangu",
          settlementRoute,
          checkoutIdempotencyKey: idempotencyKey,
          checkoutRequestHash: requestHash,
          items: orderItems,
          placedAt: now,
          createdAt: now,
          updatedAt: now,
        } as any);
      } catch (error) {
        const racedOrder = orderRepository.findByCheckoutIdempotencyKey(buyerUid, idempotencyKey);
        if (racedOrder) {
          if (racedOrder.checkoutRequestHash && racedOrder.checkoutRequestHash !== requestHash) {
            return res.status(409).json({ error: "This Idempotency-Key was already used for a different checkout request.", code: "IDEMPOTENCY_KEY_REUSED" });
          }
          const replay = idempotentCheckoutResponse(racedOrder);
          if (replay) return res.status(replay.status).json(replay.body);
        }
        throw error;
      }

      const paymentResult = await serverPaymentService.createPayment({
        orderId,
        provider: "paychangu",
        method,
        settlementRoute,
        amount: { amount: feeBreakdown.finalTotalAmount, currency },
        customer: {
          id: buyerUid,
          name: buyerName || ticketHolder.fullName || buyerEmail || buyerUid,
          email: buyerEmail || ticketHolder.email || undefined,
          phoneNumber: buyerPhone || ticketHolder.phone || undefined,
        },
        metadata: {
          listingIds,
          eventIds,
          eventDetails,
          buyerId: buyerUid,
          buyerEmail: buyerEmail || undefined,
          ticketHolder: containsEventTicket ? ticketHolder : undefined,
          settlementRoute,
          returnUrl,
          cancelUrl,
          source,
        },
        returnUrl,
        cancelUrl,
      } as any);

      orderRepository.update(orderId, (current) => ({
        ...current,
        paymentReference: paymentResult.reference ?? orderId,
        updatedAt: now,
      } as any));

      return res.status(201).json({
        success: true,
        orderId,
        paymentId: paymentResult.id,
        reference: paymentResult.reference,
        checkoutUrl: paymentResult.checkoutUrl ?? null,
        payment: paymentResult,
        order: orderRepository.findById(orderId),
        totals: {
          subtotal: total,
          total: feeBreakdown.finalTotalAmount,
          fees: feeBreakdown.payChanguTransactionFeeAmount,
        },
      });
    } catch (error) {
      return res.status(500).json(jsonError(error, "Failed to initiate checkout"));
    }
  });

  router.get("/public-status/:reference", orderLookupLimiter, async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference ?? "").trim();
      if (!reference) {
        return res.status(400).json({ error: "Reference is required" });
      }

      let { payment, order } = resolvePublicPaymentState(reference);
      if (!payment && !order) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      const paymentStatus = normalizeStatus(payment?.status);
      const orderStatus = normalizeStatus(order?.status);
      const isAlreadySuccessful =
        Boolean(payment?.verified) ||
        ["captured", "paid"].includes(paymentStatus) ||
        ["paid", "processing", "in_escrow"].includes(orderStatus);

      if (!isAlreadySuccessful) {
        try {
          await serverPaymentService.verifyPaychanguPayment(
            payment?.reference ?? order?.paymentReference ?? reference,
          );
          ({ payment, order } = resolvePublicPaymentState(reference));
        } catch (verificationError) {
          const message = verificationError instanceof Error ? verificationError.message : "Payment verification failed";
          return res.status(400).json({ error: message });
        }
      }

      return res.json(buildPublicPaymentStatus(reference));
    } catch (error) {
      return res.status(500).json(jsonError(error, "Failed to fetch public status"));
    }
  });

  router.post("/webhooks/paychangu", async (req, res) => {
    await paymentWebhookHandler(req, res);
  });

  router.post("/webhooks/payouts", async (req, res) => {
    await payoutWebhookHandler(req, res);
  });

  router.get("/orders/by-reference/:reference", requireAuth, async (req, res) => {
    try {
      const reference = decodeURIComponent(req.params.reference ?? "").trim();
      if (!reference) {
        return res.status(400).json({ error: "Reference is required" });
      }
      const order = findOrderByParam(reference);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      return res.json(buildOrderBundle(order.id));
    } catch (error) {
      return res.status(500).json(jsonError(error, "Failed to fetch order"));
    }
  });

  router.get("/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = decodeURIComponent(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ error: "Order id is required" });
      }
      const order = findOrderByParam(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      return res.json(buildOrderBundle(order.id));
    } catch (error) {
      return res.status(500).json(jsonError(error, "Failed to fetch order"));
    }
  });

  router.get("/orders/me", requireAuth, async (req: any, res) => {
    try {
      const db: any = getPaymentDb();
      const rows = db.prepare("SELECT id FROM orders WHERE buyer_id = ? ORDER BY created_at DESC").all(req.user.uid) as Array<{ id: string }>;
      return res.json(rows.map((row) => buildOrderBundle(row.id)).filter(Boolean));
    } catch (error) {
      return res.status(500).json(jsonError(error, "Failed to fetch orders"));
    }
  });

  return router;
}

export function mountPayChanguRoutes(app: express.Express, requireAuth: RequestHandler): void {
  app.use("/api/payments", createPaymentRouter(requireAuth));
}
