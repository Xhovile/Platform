import { getPaymentDb } from "../../postgresCompat.js";
import "./paychangu.card.schema.js";

export type PayChanguCardChargeStatus =
  | "pending"
  | "requires_action"
  | "pending_verification"
  | "paid"
  | "failed"
  | "cancelled"
  | "reversed"
  | "unknown";

export interface StoredPayChanguCardCharge {
  id: string;
  orderId: string;
  buyerId: string;
  paymentReference: string;
  chargeId: string;
  amount: number;
  currency: string;
  status: PayChanguCardChargeStatus;
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

type ChargeRow = Record<string, unknown>;
type ChargePatch = Partial<Pick<
  StoredPayChanguCardCharge,
  "status" | "requires3dsAuth" | "threeDsAuthUrl" | "providerOrderReference" |
  "lastProviderStatus" | "failureReason" | "verifiedAt"
>>;

const ALLOWED_TRANSITIONS: Readonly<Record<PayChanguCardChargeStatus, readonly PayChanguCardChargeStatus[]>> = {
  pending: ["pending", "requires_action", "pending_verification", "failed", "cancelled", "unknown"],
  requires_action: ["requires_action", "pending_verification", "paid", "failed", "cancelled", "unknown"],
  pending_verification: ["pending_verification", "requires_action", "paid", "failed", "cancelled", "unknown"],
  unknown: ["unknown", "pending_verification", "requires_action", "paid", "failed", "cancelled"],
  paid: ["paid", "reversed"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  reversed: ["reversed"],
};

function rowToCharge(row: ChargeRow): StoredPayChanguCardCharge {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    buyerId: String(row.buyer_id),
    paymentReference: String(row.payment_reference),
    chargeId: String(row.charge_id),
    amount: Number(row.amount),
    currency: String(row.currency),
    status: String(row.status) as PayChanguCardChargeStatus,
    requires3dsAuth: row.requires_3ds_auth === true || Number(row.requires_3ds_auth) === 1,
    threeDsAuthUrl: row.three_ds_auth_url == null ? null : String(row.three_ds_auth_url),
    resultUrl: String(row.result_url),
    providerOrderReference: row.provider_order_reference == null ? null : String(row.provider_order_reference),
    lastProviderStatus: row.last_provider_status == null ? null : String(row.last_provider_status),
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
    verifiedAt: row.verified_at == null ? null : String(row.verified_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function assertTransition(from: PayChanguCardChargeStatus, to: PayChanguCardChargeStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new Error("Illegal PayChangu card charge state transition: " + from + " -> " + to);
  }
}

export class PayChanguCardChargeRepository {
  private get db() { return getPaymentDb(); }

  create(input: Omit<StoredPayChanguCardCharge, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): StoredPayChanguCardCharge {
    const now = new Date().toISOString();
    const record: StoredPayChanguCardCharge = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };

    this.db.prepare(
      "INSERT INTO paychangu_card_charges (id, order_id, buyer_id, payment_reference, charge_id, amount, currency, status, requires_3ds_auth, three_ds_auth_url, result_url, provider_order_reference, last_provider_status, failure_reason, verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      record.id, record.orderId, record.buyerId, record.paymentReference, record.chargeId,
      record.amount, record.currency, record.status, record.requires3dsAuth ? 1 : 0,
      record.threeDsAuthUrl, record.resultUrl, record.providerOrderReference, record.lastProviderStatus,
      record.failureReason, record.verifiedAt, record.createdAt, record.updatedAt,
    );

    return record;
  }

  findByChargeId(chargeId: string): StoredPayChanguCardCharge | undefined {
    const row = this.db.prepare("SELECT * FROM paychangu_card_charges WHERE charge_id = ? LIMIT 1").get(chargeId) as ChargeRow | undefined;
    return row ? rowToCharge(row) : undefined;
  }

  findByPaymentReference(reference: string): StoredPayChanguCardCharge | undefined {
    const row = this.db.prepare("SELECT * FROM paychangu_card_charges WHERE payment_reference = ? LIMIT 1").get(reference) as ChargeRow | undefined;
    return row ? rowToCharge(row) : undefined;
  }

  updateByChargeId(chargeId: string, patch: ChargePatch): StoredPayChanguCardCharge | undefined {
    const current = this.findByChargeId(chargeId);
    if (!current) return undefined;
    const next: StoredPayChanguCardCharge = { ...current, ...patch, updatedAt: new Date().toISOString() };
    assertTransition(current.status, next.status);

    this.db.prepare(
      "UPDATE paychangu_card_charges SET status = ?, requires_3ds_auth = ?, three_ds_auth_url = ?, provider_order_reference = ?, last_provider_status = ?, failure_reason = ?, verified_at = ?, updated_at = ? WHERE charge_id = ?",
    ).run(
      next.status, next.requires3dsAuth ? 1 : 0, next.threeDsAuthUrl, next.providerOrderReference,
      next.lastProviderStatus, next.failureReason, next.verifiedAt, next.updatedAt, chargeId,
    );

    return next;
  }

  clearForTests(): void {
    this.db.prepare("DELETE FROM paychangu_card_charges").run();
  }
}

export const payChanguCardChargeRepository = new PayChanguCardChargeRepository();
