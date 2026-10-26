export type DirectCardStatus =
  | "pending"
  | "requires_action"
  | "pending_verification"
  | "paid"
  | "failed"
  | "cancelled"
  | "reversed"
  | "unknown";

export interface DirectCardOrderSnapshot {
  id: string;
  buyerId: string;
  status: string;
  amount: number;
  currency: "MWK" | "USD";
  paymentReference: string | null;
}

export interface StoredPayChanguCardCharge {
  id: string;
  orderId: string;
  buyerId: string;
  paymentReference: string;
  chargeId: string;
  amount: number;
  currency: "MWK" | "USD";
  status: DirectCardStatus;
  requires3dsAuth: boolean;
  threeDsAuthUrl: string | null;
  resultUrl: string;
  providerOrderReference: string | null;
  lastProviderStatus: string | null;
  failureReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectCardPaymentSummary {
  id: string;
  reference: string;
  orderId: string;
  status: DirectCardStatus | "captured";
  verified: boolean;
}

export interface CreatePendingDirectCardChargeInput {
  order: DirectCardOrderSnapshot;
  id: string;
  chargeId: string;
  paymentReference: string;
  resultUrl: string;
  now: string;
}

export type DirectCardChargePatch = Partial<Pick<
  StoredPayChanguCardCharge,
  "status" | "requires3dsAuth" | "threeDsAuthUrl" | "providerOrderReference" |
  "lastProviderStatus" | "failureReason" | "verifiedAt"
>>;

export interface DirectCardCheckoutStore {
  /** Return only a server-authoritative order owned by buyerId. */
  getOrder(orderId: string, buyerId: string): Promise<DirectCardOrderSnapshot | null>;
  /**
   * Atomically claim the unpaid order, bind its payment reference, and persist both the
   * pending payment intent and charge record before sending card data to PayChangu.
   * Reject if the order has acquired a payment reference or changed status meanwhile.
   */
  createPendingCharge(input: CreatePendingDirectCardChargeInput): Promise<StoredPayChanguCardCharge>;
  getChargeById(chargeId: string): Promise<StoredPayChanguCardCharge | null>;
  getChargeByPaymentReference(reference: string): Promise<StoredPayChanguCardCharge | null>;
  updateCharge(chargeId: string, patch: DirectCardChargePatch): Promise<StoredPayChanguCardCharge | null>;
  /** Persist pending/failure verification state without storing PAN or CVV. */
  recordVerification(charge: StoredPayChanguCardCharge, result: import("./paychangu.card.js").PayChanguDirectCardVerification): Promise<DirectCardPaymentSummary>;
  /**
   * Atomically/idempotently mark the payment paid and run order, escrow, ticket and
   * seller settlement effects. Repeated calls must never fulfil twice.
   */
  settleVerifiedCharge(charge: StoredPayChanguCardCharge, result: import("./paychangu.card.js").PayChanguDirectCardVerification): Promise<DirectCardPaymentSummary>;
}

export interface DirectCardAuthorizationAdapter {
  /**
   * Adapter for PayChangu's separately documented validate/authorization step.
   * Platform intentionally does not ship an endpoint implementation until PayChangu
   * confirms its exact path, request schema, and response schema.
   */
  completeAuthorization(input: {
    chargeId: string;
    providerOrderReference: string | null;
    callbackStatusHint: string | null;
  }): Promise<{ completed: boolean; failureReason?: string }>;
}
