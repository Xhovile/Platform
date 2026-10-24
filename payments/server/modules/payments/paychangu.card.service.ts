import { randomUUID } from "node:crypto";
import type { PaymentVerificationResult } from "../../../src/modules/payments/types.js";
import type { StoredPayment } from "./payment.repository.js";
import { paymentRepository } from "./payment.repository.js";
import { orderRepository } from "../orders/order.repository.js";
import { applyVerifiedPayChanguPayment } from "./paychangu.flow.js";
import {
  createPayChanguDirectCardChargeId,
  initiatePayChanguDirectCardCharge,
  validatePayChanguDirectCardFields,
  verifyPayChanguDirectCardCharge,
  type PayChanguDirectCardConfig,
} from "./paychangu.card.js";
import { payChanguCardChargeRepository, type StoredPayChanguCardCharge } from "./paychangu.card.repository.js";

export interface DirectCardDetails {
  cardNumber: string;
  expiry: string;
  cvv: string;
  cardholderName: string;
}

export interface DirectCardCheckoutInput {
  orderId: string;
  buyerId: string;
  amount: number;
  currency: "MWK" | "USD";
  email: string;
  card: DirectCardDetails;
}

export interface DirectCardCheckoutResult {
  payment: StoredPayment;
  charge: StoredPayChanguCardCharge;
  requiresAction: boolean;
  checkoutUrl: string | null;
  paymentVerified: boolean;
}

export interface DirectCardVerificationSummary {
  charge: StoredPayChanguCardCharge;
  payment: StoredPayment;
  verified: boolean;
  status: "paid" | "pending" | "failed" | "unknown";
  failureReason?: string;
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

export interface DirectCardRuntimeConfig {
  returnUrl: string;
  resultUrl: string;
  providerConfig: PayChanguDirectCardConfig;
}

function resolveDirectCardVerificationConfig(): PayChanguDirectCardConfig {
  const secret = process.env.PAYCHANGU_SECRET_KEY?.trim();
  if (!secret) throw new Error("Cannot verify a stored card charge without PAYCHANGU_SECRET_KEY.");
  return {
    paychanguSecretKey: secret,
    paychanguBaseUrl: process.env.PAYCHANGU_BASE_URL,
  };
}

export function assertPayChanguDirectCardCheckoutAvailable(): DirectCardRuntimeConfig {
  if (!truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_ENABLED)) {
    throw new Error("Direct card checkout is disabled.");
  }
  if (!truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_PCI_APPROVED)) {
    throw new Error("Direct card checkout requires confirmed PCI DSS approval and PayChangu account activation.");
  }
  if (!truthyFlag(process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED)) {
    throw new Error("Direct card checkout is blocked until PayChangu's validate-charge/3-D Secure contract is confirmed and implemented.");
  }

  const secret = process.env.PAYCHANGU_SECRET_KEY?.trim();
  if (!secret) throw new Error("Direct card checkout is missing its server-side PayChangu secret.");
  const callbackUrl = validateConfiguredHttpsUrl(
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
    returnUrl: callbackUrl,
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

function createPaymentReference(): string {
  return "PAYCHANGU-CARD-" + randomUUID().replace(/-/g, "");
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function toVerification(
  charge: StoredPayChanguCardCharge,
  input: { verified: boolean; status: string; amount?: number; currency?: string; failureReason?: string },
): PaymentVerificationResult {
  return {
    verified: input.verified,
    provider: "paychangu",
    txRef: charge.paymentReference,
    reference: charge.paymentReference,
    orderId: charge.orderId,
    status: input.status,
    currency: input.currency,
    amount: input.amount !== undefined ? { amount: input.amount, currency: input.currency ?? charge.currency } : undefined,
    failureReason: input.failureReason,
  };
}

export async function createDirectCardCheckout(input: DirectCardCheckoutInput): Promise<DirectCardCheckoutResult> {
  const runtime = assertPayChanguDirectCardCheckoutAvailable();
  if (!Number.isFinite(input.amount) || input.amount <= 0 || Math.round(input.amount * 100) / 100 !== input.amount) {
    throw new Error("Invalid server-calculated amount for direct card checkout.");
  }
  if (!["MWK", "USD"].includes(input.currency)) throw new Error("Unsupported currency for direct card checkout.");
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) throw new Error("A valid buyer email is required for direct card checkout.");
  validatePayChanguDirectCardFields(input.card);

  const order = await orderRepository.findByIdAsync(input.orderId);
  if (!order) throw new Error("Order not found for direct card checkout.");
  if (order.buyerId !== input.buyerId) throw new Error("Order does not belong to the authenticated buyer.");
  if (order.status !== "pending_payment") throw new Error("Order is not eligible for a new payment.");
  if (order.paymentReference) throw new Error("Order already has a payment reference; use the existing checkout.");
  if (Number(order.total.amount) !== input.amount || normalizeCurrency(order.total.currency) !== input.currency) {
    throw new Error("Direct card checkout amount or currency does not match the server order.");
  }

  const now = new Date().toISOString();
  const chargeId = createPayChanguDirectCardChargeId();
  const paymentReference = createPaymentReference();
  const payment: StoredPayment = {
    id: randomUUID(),
    orderId: input.orderId,
    provider: "paychangu",
    method: "card",
    status: "pending",
    amount: { amount: input.amount, currency: input.currency },
    reference: paymentReference,
    providerReference: chargeId,
    checkoutUrl: null,
    paidAt: null,
    rawResponse: { paymentFlow: "direct_card" },
    verified: false,
    createdAt: now,
    updatedAt: now,
  };

  await paymentRepository.saveAsync(payment);
  payChanguCardChargeRepository.create({
    id: randomUUID(),
    orderId: input.orderId,
    buyerId: input.buyerId,
    paymentReference,
    chargeId,
    amount: input.amount,
    currency: input.currency,
    status: "pending",
    requires3dsAuth: false,
    threeDsAuthUrl: null,
    resultUrl: runtime.resultUrl,
    providerOrderReference: null,
    lastProviderStatus: null,
    failureReason: null,
    verifiedAt: null,
  });
  orderRepository.update(input.orderId, (current) => ({
    ...current,
    paymentReference,
    updatedAt: new Date().toISOString(),
  } as any));

  let initiation;
  try {
    initiation = await initiatePayChanguDirectCardCharge({
      amount: input.amount,
      currency: input.currency,
      email: input.email.trim(),
      redirectUrl: runtime.returnUrl,
      chargeId,
      cardNumber: input.card.cardNumber,
      expiry: input.card.expiry,
      cvv: input.card.cvv,
      cardholderName: input.card.cardholderName,
    }, resolveDirectCardVerificationConfig());
  } catch {
    payChanguCardChargeRepository.updateByChargeId(chargeId, {
      status: "unknown",
      failureReason: "The initiation result could not be confirmed. Verify this charge before retrying.",
    });
    throw new Error("Card charge initiation could not be confirmed. Do not retry until the payment status has been checked.");
  }

  const charge = payChanguCardChargeRepository.updateByChargeId(chargeId, {
    status: initiation.requires3dsAuth ? "requires_action" : "pending_verification",
    requires3dsAuth: initiation.requires3dsAuth,
    threeDsAuthUrl: initiation.threeDsAuthUrl ?? null,
    providerOrderReference: initiation.providerOrderReference ?? null,
    failureReason: null,
  });
  if (!charge) throw new Error("Failed to update the Direct Card Charge record.");

  const updatedPayment = await paymentRepository.updateByReferenceAsync(paymentReference, (current) => ({
    ...current,
    status: initiation.requires3dsAuth ? "requires_action" : "pending",
    checkoutUrl: initiation.threeDsAuthUrl ?? null,
    rawResponse: { paymentFlow: "direct_card", requires3dsAuth: initiation.requires3dsAuth },
    updatedAt: new Date().toISOString(),
  }));

  if (!updatedPayment) throw new Error("Direct Card Charge payment record was not found after initiation.");

  if (initiation.requires3dsAuth) {
    return { payment: updatedPayment, charge, requiresAction: true, checkoutUrl: initiation.threeDsAuthUrl ?? null, paymentVerified: false };
  }

  const verification = await verifyAndSettleDirectCardCharge(chargeId);
  return {
    payment: verification.payment,
    charge: verification.charge,
    requiresAction: false,
    checkoutUrl: null,
    paymentVerified: verification.verified,
  };
}

export async function verifyAndSettleDirectCardCharge(chargeId: string): Promise<DirectCardVerificationSummary> {
  const charge = payChanguCardChargeRepository.findByChargeId(chargeId);
  if (!charge) throw new Error("Direct Card Charge reference was not found.");
  const payment = await paymentRepository.findByReferenceAsync(charge.paymentReference);
  if (!payment) throw new Error("Stored payment for Direct Card Charge was not found.");

  if (charge.status === "paid" && payment.verified && payment.status === "captured") {
    return { charge, payment, verified: true, status: "paid" };
  }
  if (charge.status === "failed" || charge.status === "cancelled" || charge.status === "reversed") {
    return { charge, payment, verified: false, status: "failed", failureReason: charge.failureReason ?? "The card charge is no longer payable." };
  }

  let result;
  try {
    result = await verifyPayChanguDirectCardCharge({
      chargeId: charge.chargeId,
      expectedAmount: charge.amount,
      expectedCurrency: charge.currency as "MWK" | "USD",
    }, runtime.providerConfig);
  } catch {
    const updatedCharge = payChanguCardChargeRepository.updateByChargeId(chargeId, {
      status: "unknown",
      failureReason: "PayChangu verification was unavailable; the payment remains unconfirmed.",
    }) ?? charge;
    return { charge: updatedCharge, payment, verified: false, status: "unknown", failureReason: updatedCharge.failureReason ?? undefined };
  }

  const now = new Date().toISOString();
  if (result.verified) {
    const verification = toVerification(charge, {
      verified: true,
      status: "captured",
      amount: result.amount,
      currency: result.currency,
    });
    await applyVerifiedPayChanguPayment({
      ...verification,
      verified: true,
      provider: "paychangu",
      txRef: charge.paymentReference,
      reference: charge.paymentReference,
      status: "captured",
      amount: { amount: charge.amount, currency: charge.currency },
      currency: charge.currency,
      checkoutUrl: null,
    });

    const paidCharge = payChanguCardChargeRepository.updateByChargeId(chargeId, {
      status: "paid",
      lastProviderStatus: result.status,
      failureReason: null,
      verifiedAt: now,
    }) ?? charge;
    const paidPayment = await paymentRepository.updateByReferenceAsync(charge.paymentReference, (current) => ({
      ...current,
      status: "captured",
      verified: true,
      verification,
      paidAt: current.paidAt ?? now,
      updatedAt: now,
    }));
    return { charge: paidCharge, payment: paidPayment ?? payment, verified: true, status: "paid" };
  }

  const failClosed = result.status === "failed" || result.status === "reversed";
  const nextStatus = failClosed ? "failed" : result.status === "pending" ? "pending_verification" : "unknown";
  const reason = result.failureReason ?? "PayChangu has not confirmed a successful card charge.";
  const failedOrPendingCharge = payChanguCardChargeRepository.updateByChargeId(chargeId, {
    status: nextStatus,
    lastProviderStatus: result.status,
    failureReason: reason,
  }) ?? charge;
  const verification = toVerification(charge, {
    verified: false,
    status: result.status,
    amount: result.amount,
    currency: result.currency,
    failureReason: reason,
  });
  const updatedPayment = await paymentRepository.updateByReferenceAsync(charge.paymentReference, (current) => ({
    ...current,
    status: failClosed ? "failed" : current.status,
    verified: false,
    verification,
    updatedAt: now,
  }));
  return {
    charge: failedOrPendingCharge,
    payment: updatedPayment ?? payment,
    verified: false,
    status: failClosed ? "failed" : result.status === "pending" ? "pending" : "unknown",
    failureReason: reason,
  };
}

export function buildDirectCardResultRedirect(charge: StoredPayChanguCardCharge, status: "paid" | "pending" | "failed" | "unknown"): string {
  const target = new URL(charge.resultUrl);
  target.searchParams.set("reference", charge.paymentReference);
  target.searchParams.set("payment_status", status);
  return target.toString();
}
