import type { ReactNode } from "react";
import type {
  PayoutDestination,
  PayoutDestinationFormState,
  PayoutDestinationPayload,
  PayoutRecord,
} from "../../modules/payouts/types";

export const INITIAL_PAYOUT_DESTINATION_FORM: PayoutDestinationFormState = {
  destinationType: "mobile_money",
  providerName: "",
  providerRefId: "",
  currency: "MWK",
  accountName: "",
  accountNumber: "",
  mobile: "",
  isDefault: true,
};

export const REFRESH_INTERVAL_MS = 30_000;
export const REMOVE_COUNTDOWN_SECONDS = 3;
export const DEFAULT_CURRENCY = "MWK";
export const DEFAULT_CONNECT_SCOPE = "payments:write payments:read";

export type DestinationQueueDiagnostic = {
  shouldAppearInAdminQueue: boolean;
  summary: string;
  reasons: string[];
};

export function buildDestinationQueueDiagnostic(destination: PayoutDestination): DestinationQueueDiagnostic {
  const verificationStatus = (destination.verificationStatus || "").trim().toLowerCase();
  const reasons: string[] = [];

  if (verificationStatus === "verified" && destination.isActive && !destination.lastError) {
    return {
      shouldAppearInAdminQueue: false,
      summary:
        "This destination is already verified and active, so the admin queue intentionally hides it.",
      reasons: [
        "verification_status is verified",
        "is_active is true",
        "last_error is empty",
      ],
    };
  }

  if (verificationStatus !== "verified") {
    reasons.push(`verification_status = ${destination.verificationStatus || "pending"}`);
  }

  if (!destination.isActive) {
    reasons.push("is_active = false");
  }

  if (destination.lastError) {
    reasons.push(`last_error = ${destination.lastError}`);
  }

  return {
    shouldAppearInAdminQueue: true,
    summary:
      reasons.length > 0
        ? "This destination should appear in the admin queue because it still needs review."
        : "This destination should appear in the admin queue. If it does not, the admin and seller APIs are likely reading different databases or environments.",
    reasons,
  };
}

export function money(amount: number, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat("en-MW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function payoutMathBreakdown(payout: PayoutRecord) {
  const currency = payout.currency || DEFAULT_CURRENCY;
  const grossAmount = Number(payout.grossAmount ?? payout.amount ?? 0);
  const platformFeeAmount = Number(payout.platformFeeAmount ?? 0);
  const payChanguFeeAmount = Number(payout.payoutFeeAmount ?? 0);
  const reserveAmount = Number(payout.reserveAmount ?? 0);
  const sellerReceivesAmount = Number(payout.sellerReceivesAmount ?? payout.netAmount ?? payout.amount ?? 0);

  return {
    currency,
    grossAmount,
    platformFeeAmount,
    payChanguFeeAmount,
    reserveAmount,
    sellerReceivesAmount,
    hasFormula: payout.grossAmount !== null && payout.grossAmount !== undefined,
  };
}

export function payoutFeeNote(payout: PayoutRecord) {
  const { payChanguFeeAmount, currency } = payoutMathBreakdown(payout);
  if (payChanguFeeAmount > 0) {
    return `PayChangu mobile money transaction fee (3%): -${money(payChanguFeeAmount, currency)}`;
  }

  return "PayChangu mobile money transaction fee is shown once the payout formula is available.";
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function toEscrowSummaryRecord(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const escrow = value as Record<string, unknown>;

  const normalizeAmount = (input: unknown): number | string | null => {
    if (input === null || input === undefined) return null;
    if (typeof input === "number" || typeof input === "string") return input;
    return null;
  };

  const readAmountField = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = normalizeAmount(escrow[key]);
      if (candidate !== null) return candidate;
    }
    return null;
  };

  return {
    amount: readAmountField(
      "amount",
      "balanceAmount",
      "balance_amount",
      "totalAmount",
      "total_amount",
    ),
    grossAmount: readAmountField(
      "grossAmount",
      "gross_amount",
      "totalAmount",
      "total_amount",
      "balanceAmount",
      "balance_amount",
    ),
    netAmount: readAmountField(
      "netAmount",
      "net_amount",
      "balanceAmount",
      "balance_amount",
    ),
    sellerAmount: readAmountField(
      "sellerAmount",
      "seller_amount",
      "balanceAmount",
      "balance_amount",
    ),
    status: typeof escrow.status === "string" ? escrow.status : undefined,
    state: typeof escrow.state === "string" ? escrow.state : undefined,
  };
}

export function validateDestinationForm(form: PayoutDestinationFormState) {
  const providerName = form.providerName.trim();
  const accountName = form.accountName.trim();
  const providerRefId = form.providerRefId.trim();
  const accountNumber = form.accountNumber.trim();
  const mobile = form.mobile.trim();

  if (!providerName || !accountName) {
    return "Provider and account name are required.";
  }

  if (!providerRefId) {
    return "Please select a supported payout provider from the list.";
  }

  if (form.destinationType === "bank" && !accountNumber) {
    return "Bank account number is required.";
  }

  if (form.destinationType === "mobile_money" && !mobile) {
    return "Mobile number is required.";
  }

  return null;
}

export function buildDestinationPayload(
  sellerUid: string,
  form: PayoutDestinationFormState,
): PayoutDestinationPayload {
  return {
    sellerUid,
    destinationType: form.destinationType,
    providerName: form.providerName.trim(),
    providerRefId: form.providerRefId.trim() || undefined,
    currency: form.currency.trim() || DEFAULT_CURRENCY,
    accountName: form.accountName.trim(),
    accountNumber: form.destinationType === "bank" ? form.accountNumber.trim() : undefined,
    mobile: form.destinationType === "mobile_money" ? form.mobile.trim() : undefined,
    isDefault: form.isDefault,
  };
}

export function statusPill(label: string, value: ReactNode) {
  return { label, value };
}
