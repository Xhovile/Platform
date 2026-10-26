import { randomUUID } from "node:crypto";
import {
  createPayChanguDirectCardChargeId,
  initiatePayChanguDirectCardCharge,
  validatePayChanguDirectCardFields,
  verifyPayChanguDirectCardCharge,
  type PayChanguDirectCardConfig,
  type PayChanguDirectCardInitiation,
  type PayChanguDirectCardVerification,
} from "./paychangu.card.js";
import type {
  DirectCardAuthorizationAdapter,
  DirectCardCheckoutStore,
  DirectCardOrderSnapshot,
  DirectCardPaymentSummary,
  StoredPayChanguCardCharge,
  DirectCardVerificationRecord,
} from "./paychangu.card.contracts.js";

export interface DirectCardCheckoutInput {
  orderId: string;
  buyerId: string;
  email: string;
  card: {
    cardNumber: string;
    expiry: string;
    cvv: string;
    cardholderName: string;
  };
}

export interface DirectCardCheckoutResult {
  payment: DirectCardPaymentSummary;
  charge: StoredPayChanguCardCharge;
  requiresAction: boolean;
  checkoutUrl: string | null;
  paymentVerified: boolean;
}

export interface DirectCardReturnResult extends DirectCardVerificationRecord {
  status: "paid" | "pending" | "failed" | "unknown";
  verified: boolean;
  redirectUrl: string;
  failureReason?: string;
}

export interface DirectCardServiceDependencies {
  store: DirectCardCheckoutStore;
  /** Must be a reviewed adapter for PayChangu's confirmed validation/authorization API. */
  authorizationAdapter?: DirectCardAuthorizationAdapter;
}

export interface DirectCardRuntimeConfig {
  returnUrl: string;
  resultUrl: string;
  providerConfig: PayChanguDirectCardConfig;
}

function truthyFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function readHosts(name: string): string[] {
  return String(process.env[name] ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
}

function validateConfiguredHttpsUrl(value: string | undefined, label: string, allowedHosts: string[]): string {
  if (!value?.trim()) throw new Error(label + " is not configured.");
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(label + " must be an HTTPS URL without embedded credentials.");
  }
  if (!allowedHosts.length || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error(label + " host is not in its configured exact-host allowlist.");
  }
  return url.toString();
}

/** Guard for creating new charges only; it is not used to reconcile already stored charges. */
export function assertPayChanguDirectCardCheckoutAvailable(
  authorizationAdapter?: DirectCardAuthorizationAdapter,
): DirectCardRuntimeConfig {
  if (!truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_ENABLED)) {
    throw new Error("Direct card checkout is disabled.");
  }
  if (!truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_PCI_APPROVED)) {
    throw new Error("Direct card checkout requires confirmed PCI DSS approval and PayChangu account activation.");
  }
  if (!truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED) ||
      !authorizationAdapter ||
      typeof authorizationAdapter.completeAuthorization !== "function") {
    throw new Error("Direct card checkout is blocked until PayChangu's validation/authorization contract is confirmed and its adapter is registered.");
  }

  const secret = process.env.PAYCHANGU_SECRET_KEY?.trim();
  if (!secret) throw new Error("Direct card checkout is missing its server-side PayChangu secret.");

  const returnUrl = validateConfiguredHttpsUrl(
    process.env.PAYCHANGU_DIRECT_CARD_RETURN_URL,
    "PayChangu Direct Card return URL",
    readHosts("PAYCHANGU_DIRECT_CARD_RETURN_HOSTS"),
  );
  const resultUrl = validateConfiguredHttpsUrl(
    process.env.PAYCHANGU_DIRECT_CARD_RESULT_URL,
    "PayChangu Direct Card result URL",
    readHosts("PAYCHANGU_DIRECT_CARD_RESULT_HOSTS"),
  );

  return {
    returnUrl,
    resultUrl,
    providerConfig: {
      enabled: true,
      pciDssApproved: true,
      paychanguSecretKey: secret,
      paychanguBaseUrl: process.env.PAYCHANGU_BASE_URL,
      allowedRedirectHosts: readHosts("PAYCHANGU_DIRECT_CARD_RETURN_HOSTS"),
    },
  };
}

function resolveVerificationConfig(): PayChanguDirectCardConfig {
  const secret = process.env.PAYCHANGU_SECRET_KEY?.trim();
  if (!secret) throw new Error("Cannot verify a stored card charge without PAYCHANGU_SECRET_KEY.");
  return {
    paychanguSecretKey: secret,
    paychanguBaseUrl: process.env.PAYCHANGU_BASE_URL,
  };
}

function createPaymentReference(): string {
  return "PAYCHANGU-CARD-" + randomUUID().replace(/-/g, "");
}

function buildResultRedirect(charge: StoredPayChanguCardCharge, status: DirectCardReturnResult["status"]): string {
  const target = new URL(charge.resultUrl);
  target.searchParams.set("reference", charge.paymentReference);
  target.searchParams.set("payment_status", status);
  return target.toString();
}

function statusFromVerification(result: PayChanguDirectCardVerification): DirectCardReturnResult["status"] {
  if (result.verified && result.status === "paid") return "paid";
  if (result.status === "failed" || result.status === "reversed") return "failed";
  if (result.status === "pending") return "pending";
  return "unknown";
}

function unconfirmedVerification(
  chargeId: string,
  status: PayChanguDirectCardVerification["status"],
  failureReason: string,
): PayChanguDirectCardVerification {
  return { chargeId, verified: false, status, failureReason };
}

function resultFromRecord(
  record: DirectCardVerificationRecord,
  result: PayChanguDirectCardVerification,
): DirectCardReturnResult {
  const status = statusFromVerification(result);
  return {
    charge: record.charge,
    payment: record.payment,
    status,
    verified: Boolean(result.verified && status === "paid" && record.payment.verified),
    redirectUrl: buildResultRedirect(record.charge, status),
    failureReason: result.failureReason ?? record.charge.failureReason ?? undefined,
  };
}

export function createPayChanguDirectCardService(dependencies: DirectCardServiceDependencies) {
  const { store, authorizationAdapter } = dependencies;

  async function getPayment(charge: StoredPayChanguCardCharge): Promise<DirectCardPaymentSummary> {
    const payment = await store.getPaymentSummary(charge.paymentReference);
    if (!payment) throw new Error("Stored payment summary was not found for the Direct Card Charge.");
    return payment;
  }

  async function verifyAndSettle(
    chargeId: string,
    callbackStatusHint: string | null = null,
  ): Promise<DirectCardReturnResult> {
    const normalizedChargeId = chargeId.trim();
    let charge = await store.getChargeById(normalizedChargeId);
    if (!charge) throw new Error("Direct Card Charge reference was not found.");

    if (charge.status === "paid") {
      const payment = await getPayment(charge);
      return {
        charge,
        payment,
        status: "paid",
        verified: payment.verified,
        redirectUrl: buildResultRedirect(charge, "paid"),
      };
    }

    if (["failed", "cancelled", "reversed"].includes(charge.status)) {
      const payment = await getPayment(charge);
      return {
        charge,
        payment,
        status: "failed",
        verified: false,
        redirectUrl: buildResultRedirect(charge, "failed"),
        failureReason: charge.failureReason ?? undefined,
      };
    }

    if (charge.requires3dsAuth && !charge.authorizationCompleted) {
      if (!authorizationAdapter || !truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED)) {
        const reason = "PayChangu's validation/authorization contract is not configured; the charge remains unconfirmed.";
        const record = await store.recordVerification(
          charge.chargeId,
          unconfirmedVerification(charge.chargeId, "pending", reason),
        );
        return resultFromRecord(record, unconfirmedVerification(charge.chargeId, "pending", reason));
      }

      let authorization: { completed: boolean; failureReason?: string };
      try {
        authorization = await authorizationAdapter.completeAuthorization({
          chargeId: charge.chargeId,
          providerOrderReference: charge.providerOrderReference,
          callbackStatusHint: callbackStatusHint?.slice(0, 32) ?? null,
        });
      } catch {
        authorization = {
          completed: false,
          failureReason: "PayChangu authorization validation could not be confirmed.",
        };
      }

      if (!authorization.completed) {
        const reason = authorization.failureReason ?? "Cardholder authorization is not yet confirmed.";
        const result = unconfirmedVerification(charge.chargeId, "pending", reason);
        const record = await store.recordVerification(charge.chargeId, result);
        return resultFromRecord(record, result);
      }

      const authRecord = await store.recordAuthorizationResult(charge.chargeId, { completed: true });
      charge = authRecord.charge;
    }

    let result: PayChanguDirectCardVerification;
    try {
      result = await verifyPayChanguDirectCardCharge({
        chargeId: charge.chargeId,
        expectedAmount: charge.amount,
        expectedCurrency: charge.currency,
      }, resolveVerificationConfig());
    } catch {
      result = unconfirmedVerification(
        charge.chargeId,
        "unknown",
        "PayChangu verification was unavailable; the charge remains unconfirmed.",
      );
      const record = await store.recordVerification(charge.chargeId, result);
      return resultFromRecord(record, result);
    }

    if (result.verified && result.status === "paid") {
      const record = await store.settleVerifiedCharge(charge.chargeId, result);
      return {
        charge: record.charge,
        payment: record.payment,
        status: "paid",
        verified: record.payment.verified,
        redirectUrl: buildResultRedirect(record.charge, "paid"),
      };
    }

    const record = await store.recordVerification(charge.chargeId, result);
    return resultFromRecord(record, result);
  }

  return {
    async createCheckout(input: DirectCardCheckoutInput): Promise<DirectCardCheckoutResult> {
      const runtime = assertPayChanguDirectCardCheckoutAvailable(authorizationAdapter);
      if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) {
        throw new Error("A valid buyer email is required for direct card checkout.");
      }
      validatePayChanguDirectCardFields(input.card);

      const order: DirectCardOrderSnapshot | null = await store.getOrder(input.orderId, input.buyerId);
      if (!order) throw new Error("Order not found or not owned by the authenticated buyer.");
      if (order.status !== "pending_payment") throw new Error("Order is not eligible for a new payment.");
      if (order.paymentReference) throw new Error("Order already has a payment reference; use the existing checkout.");
      if (!Number.isFinite(order.amount) || order.amount <= 0 || Math.abs(order.amount * 100 - Math.round(order.amount * 100)) > 1e-7) {
        throw new Error("The stored order has an invalid payment amount.");
      }
      if (order.currency !== "MWK" && order.currency !== "USD") {
        throw new Error("The stored order has an unsupported payment currency.");
      }

      const now = new Date().toISOString();
      const chargeId = createPayChanguDirectCardChargeId();
      const paymentReference = createPaymentReference();
      await store.createPendingCharge({
        order,
        id: randomUUID(),
        chargeId,
        paymentReference,
        resultUrl: runtime.resultUrl,
        now,
      });

      let initiation: PayChanguDirectCardInitiation;
      try {
        initiation = await initiatePayChanguDirectCardCharge({
          amount: order.amount,
          currency: order.currency,
          email: input.email.trim().toLowerCase(),
          redirectUrl: runtime.returnUrl,
          chargeId,
          cardNumber: input.card.cardNumber,
          expiry: input.card.expiry,
          cvv: input.card.cvv,
          cardholderName: input.card.cardholderName,
        }, runtime.providerConfig);
      } catch {
        const reason = "The initiation outcome could not be confirmed. Verify the charge before retrying.";
        const result = unconfirmedVerification(chargeId, "unknown", reason);
        await store.recordVerification(chargeId, result);
        throw new Error("Card charge initiation could not be confirmed. Do not retry until the payment status has been checked. Reference: " + chargeId);
      }

      const initiationRecord = await store.recordInitiationResult(chargeId, initiation);
      if (initiation.requires3dsAuth) {
        return {
          payment: initiationRecord.payment,
          charge: initiationRecord.charge,
          requiresAction: true,
          checkoutUrl: initiation.threeDsAuthUrl ?? null,
          paymentVerified: false,
        };
      }

      const verification = await verifyAndSettle(chargeId);
      return {
        payment: verification.payment,
        charge: verification.charge,
        requiresAction: false,
        checkoutUrl: null,
        paymentVerified: verification.verified,
      };
    },

    /** Browser-return status is a hint only; it never proves that the charge was paid. */
    async handleReturn(input: { chargeId: string; callbackStatusHint?: string | null }): Promise<DirectCardReturnResult> {
      return verifyAndSettle(input.chargeId, input.callbackStatusHint ?? null);
    },

    async reconcile(chargeId: string): Promise<DirectCardReturnResult> {
      return verifyAndSettle(chargeId, null);
    },
  };
}
