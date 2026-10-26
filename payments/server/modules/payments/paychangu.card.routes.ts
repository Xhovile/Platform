import express, { type RequestHandler, type Request } from "express";
import type {
  DirectCardCheckoutInput,
  DirectCardCheckoutResult,
  DirectCardReturnResult,
} from "./paychangu.card.service.js";

export interface DirectCardCheckoutService {
  createCheckout(input: DirectCardCheckoutInput): Promise<DirectCardCheckoutResult>;
  handleReturn(input: { chargeId: string; callbackStatusHint?: string | null }): Promise<DirectCardReturnResult>;
}

export interface PayChanguDirectCardRouteDependencies {
  service: DirectCardCheckoutService;
  authenticate: RequestHandler;
  rateLimit: RequestHandler;
  /** Application-owned auth resolver; do not read buyer identity from the request body. */
  resolveBuyerId(request: Request): string | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : "";
}

function classifyCheckoutFailure(error: unknown): { status: number; message: string } {
  const reason = error instanceof Error ? error.message : "";
  if (/Direct card checkout is disabled|requires confirmed PCI DSS|blocked until PayChangu|missing its server-side PayChangu secret|URL is not configured|host is not in its configured exact-host allowlist/i.test(reason)) {
    return { status: 503, message: "Direct card checkout is not currently available." };
  }
  if (/Order not found or not owned/i.test(reason)) {
    return { status: 404, message: "Order not found." };
  }
  if (/not eligible for a new payment|already has a payment reference/i.test(reason)) {
    return { status: 409, message: "This order cannot start another payment." };
  }
  if (/valid buyer email|Invalid card|card number|expiry|security code|cardholder name|invalid payment amount|unsupported payment currency/i.test(reason)) {
    return { status: 400, message: "Check the buyer email and card details." };
  }
  return { status: 500, message: "Card checkout could not be initialized. No payment success has been assumed." };
}

/**
 * Application-neutral route factory. The consumer supplies authentication, rate limiting,
 * buyer identity, and an app-specific DirectCardCheckoutStore via the service dependency.
 * Card fields are passed straight to the service; this module never logs or persists them.
 */
export function createPayChanguDirectCardRouter(dependencies: PayChanguDirectCardRouteDependencies): express.Router {
  const router = express.Router();

  router.post("/checkout", dependencies.rateLimit, dependencies.authenticate, async (req: any, res) => {
    const buyerId = dependencies.resolveBuyerId(req);
    if (!buyerId?.trim()) return res.status(401).json({ error: "Authentication required." });

    const body: unknown = req.body;
    if (!isRecord(body)) return res.status(400).json({ error: "A valid checkout request is required." });

    const orderId = readString(body.orderId, 120);
    const email = readString(body.email, 254);
    const card = body.card;

    if (!orderId || !email || !isRecord(card)) {
      return res.status(400).json({ error: "Order ID, buyer email, and card details are required." });
    }

    const input: DirectCardCheckoutInput = {
      orderId,
      buyerId: buyerId.trim(),
      email,
      card: {
        cardNumber: readString(card.cardNumber, 40),
        expiry: readString(card.expiry, 12),
        cvv: readString(card.cvv, 8),
        cardholderName: readString(card.cardholderName, 120),
      },
    };

    try {
      const result = await dependencies.service.createCheckout(input);
      return res.status(201).json({
        success: true,
        paymentFlow: "direct_card",
        orderId: result.charge.orderId,
        paymentId: result.payment.id,
        reference: result.payment.reference,
        paymentStatus: result.payment.status,
        paymentVerified: result.paymentVerified,
        requiresAction: result.requiresAction,
        checkoutUrl: result.checkoutUrl,
      });
    } catch (error) {
      const failure = classifyCheckoutFailure(error);
      return res.status(failure.status).json({ error: failure.message });
    }
  });

  router.get("/return", dependencies.rateLimit, async (req, res) => {
    const chargeId = readString(req.query.charge_id, 120);
    if (!chargeId) return res.status(400).json({ error: "Charge ID is required." });

    try {
      const result = await dependencies.service.handleReturn({
        chargeId,
        // Provider/browser status is explicitly a hint, never authoritative payment state.
        callbackStatusHint: readString(req.query.status, 32) || null,
      });
      return res.redirect(303, result.redirectUrl);
    } catch {
      // Do not use a callback-provided URL or status in this error path.
      return res.status(404).json({ error: "The card payment could not be located or verified." });
    }
  });

  return router;
}
