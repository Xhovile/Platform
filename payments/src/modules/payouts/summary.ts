import type { PayoutRecord, PayoutStatus } from "./types";
import { ESCROW_ACTIVE_STATES } from "../escrow/states";

const SELLER_ESCROW_ACTIVE_STATES = new Set([
  ...ESCROW_ACTIVE_STATES,
  "in_escrow",
]);

export type SellerEarningsBucketKey =
  | "lifetimeSales"
  | "inEscrow"
  | "availableForPayout"
  | "pendingPayout"
  | "paidOut"
  | "failedActionRequired";

export type SellerEarningsBuckets = Record<SellerEarningsBucketKey, number>;

export type EscrowSummaryRecord = {
  amount?: number | string | null;
  balanceAmount?: number | string | null;
  grossAmount?: number | string | null;
  netAmount?: number | string | null;
  sellerAmount?: number | string | null;
  totalAmount?: number | string | null;
  status?: string | null;
  state?: string | null;
};

export type SellerEarningsSummaryTotals = Partial<
  Record<SellerEarningsBucketKey, number | string | null>
> & {
  lifetime_sales?: number | string | null;
  in_escrow?: number | string | null;
  available_for_payout?: number | string | null;
  pending_payout?: number | string | null;
  paid_out?: number | string | null;
  failed_action_required?: number | string | null;
  total?: number | string | null;
  totalSales?: number | string | null;
  total_sales?: number | string | null;
  totalPayoutVolume?: number | string | null;
  total_payout_volume?: number | string | null;
  currency?: string | null;
};

export type SellerEarningsDestination = {
  isActive?: boolean | null;
  verificationStatus?: string | null;
  currency?: string | null;
};

export type SellerEarningsSummaryInput = SellerEarningsSummaryTotals & {
  payouts?: PayoutRecord[] | null;
  escrows?: EscrowSummaryRecord[] | null;
  destinations?: SellerEarningsDestination[] | null;
};

export type SellerEarningsSummary = SellerEarningsBuckets & {
  currency: string;
  hasFailedPayout: boolean;
  hasHeldPayout: boolean;
  hasMissingDestination: boolean;
  hasUnverifiedDestination: boolean;
};

const EMPTY_BUCKETS: SellerEarningsBuckets = {
  lifetimeSales: 0,
  inEscrow: 0,
  availableForPayout: 0,
  pendingPayout: 0,
  paidOut: 0,
  failedActionRequired: 0,
};

const AVAILABLE_STATUSES: PayoutStatus[] = ["eligible"];
const PENDING_STATUSES: PayoutStatus[] = [
  "queued",
  "processing",
  "pending",
  "held",
];
const PAID_STATUSES: PayoutStatus[] = ["paid"];
const FAILED_STATUSES: PayoutStatus[] = ["failed"];

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function payoutAmount(payout: PayoutRecord): number {
  return amount(payout.netAmount ?? payout.amount);
}

function escrowAmount(escrow: EscrowSummaryRecord): number {
  return amount(
    escrow.balanceAmount ??
      escrow.sellerAmount ??
      escrow.netAmount ??
      escrow.grossAmount ??
      escrow.amount ??
      escrow.totalAmount,
  );
}

function addPayoutBuckets(
  summary: SellerEarningsBuckets,
  payouts: PayoutRecord[],
) {
  for (const payout of payouts) {
    const value = payoutAmount(payout);

    if (AVAILABLE_STATUSES.includes(payout.status)) {
      summary.availableForPayout += value;
      summary.lifetimeSales += value;
    } else if (PENDING_STATUSES.includes(payout.status)) {
      summary.pendingPayout += value;
      summary.lifetimeSales += value;
    } else if (PAID_STATUSES.includes(payout.status)) {
      summary.paidOut += value;
      summary.lifetimeSales += value;
    } else if (FAILED_STATUSES.includes(payout.status)) {
      summary.failedActionRequired += value;
      summary.lifetimeSales += value;
    }
  }
}

function addEscrowBuckets(
  summary: SellerEarningsBuckets,
  escrows: EscrowSummaryRecord[],
) {
  for (const escrow of escrows) {
    const state = String(escrow.state ?? escrow.status ?? "").toLowerCase();
    if (SELLER_ESCROW_ACTIVE_STATES.has(state)) {
      const value = escrowAmount(escrow);
      summary.inEscrow += value;
      summary.lifetimeSales += value;
    }
  }
}

function applyExplicitTotals(
  summary: SellerEarningsBuckets,
  input: SellerEarningsSummaryTotals,
) {
  const aliasValues: Partial<Record<SellerEarningsBucketKey, unknown>> = {
    lifetimeSales: input.lifetime_sales,
    inEscrow: input.in_escrow,
    availableForPayout: input.available_for_payout,
    pendingPayout: input.pending_payout,
    paidOut: input.paid_out,
    failedActionRequired: input.failed_action_required,
  };

  for (const key of Object.keys(EMPTY_BUCKETS) as SellerEarningsBucketKey[]) {
    const value = input[key] ?? aliasValues[key];
    if (value !== undefined && value !== null) {
      summary[key] = amount(value);
    }
  }

  if (input.lifetimeSales === undefined || input.lifetimeSales === null) {
    const total =
      input.totalSales ??
      input.total_sales ??
      input.total ??
      input.totalPayoutVolume ??
      input.total_payout_volume;
    if (total !== undefined && total !== null) {
      summary.lifetimeSales = amount(total);
    }
  }
}

export function buildSellerEarningsSummary(
  input: SellerEarningsSummaryInput = {},
): SellerEarningsSummary {
  const summary: SellerEarningsBuckets = { ...EMPTY_BUCKETS };
  const payouts = Array.isArray(input.payouts) ? input.payouts : [];
  const escrows = Array.isArray(input.escrows) ? input.escrows : [];
  const destinations = Array.isArray(input.destinations)
    ? input.destinations
    : [];

  addPayoutBuckets(summary, payouts);
  addEscrowBuckets(summary, escrows);
  applyExplicitTotals(summary, input);

  const activeDestinations = destinations.filter(
    (destination) => destination.isActive !== false,
  );
  const hasMissingDestination =
    destinations.length > 0 ? activeDestinations.length === 0 : false;
  const hasUnverifiedDestination =
    activeDestinations.length > 0 &&
    !activeDestinations.some(
      (destination) =>
        String(destination.verificationStatus ?? "").toLowerCase() ===
        "verified",
    );

  return {
    ...summary,
    currency:
      input.currency ||
      payouts[0]?.currency ||
      destinations[0]?.currency ||
      "MWK",
    hasFailedPayout:
      summary.failedActionRequired > 0 ||
      payouts.some((payout) => payout.status === "failed"),
    hasHeldPayout: payouts.some((payout) => payout.status === "held"),
    hasMissingDestination,
    hasUnverifiedDestination,
  };
}

export function formatSellerEarningsAmount(
  amountValue: number,
  currency = "MWK",
) {
  return new Intl.NumberFormat("en-MW", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountValue || 0);
}