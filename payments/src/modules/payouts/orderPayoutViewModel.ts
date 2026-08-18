import {
  getSellerPayoutLaunchStatusMeta,
  getSellerPayoutStatusLabel,
  type SellerPayoutSignalInput,
} from "./uiModel";
import type { SellerOrderPayoutMetadata } from "../../shared/types/payment";
import { maskAccountLast4 } from "./masking";

export type SellerOrderPayoutViewModelInput = {
  metadata: SellerOrderPayoutMetadata;
  providerError?: string | null;
  adminNotes?: string | null;
};

export type SellerOrderPayoutViewModel = {
  payoutStatusLabel: string;
  payoutStatusDetail: string;
  releaseEligibilityLabel: string;
  releaseEligibilityDetail: string;
  paymentCapturedLabel: string;
  estimatedPayoutDate: string;
  payoutDestinationMask: string;
  nextStepGuidance: string;
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function normalizeMaskedDestination(mask?: string | null): string {
  return maskAccountLast4(mask) ?? "Not configured";
}

function releaseEligibilityCopy(eligibility: SellerOrderPayoutMetadata["releaseEligibility"]) {
  if (eligibility === "eligible") {
    return {
      label: "Eligible for payout queue",
      detail: "Escrow has been released and payout can continue in the launch queue.",
    };
  }
  if (eligibility === "blocked") {
    return {
      label: "Release blocked",
      detail: "Escrow is currently held or disputed and cannot move to payout yet.",
    };
  }
  if (eligibility === "awaiting_release") {
    return {
      label: "Awaiting escrow release",
      detail: "Payment is captured, but escrow release must complete first.",
    };
  }
  return {
    label: "Not payout eligible yet",
    detail: "Payment confirmation is still pending before payout tracking starts.",
  };
}

export function buildSellerOrderPayoutViewModel(
  input: SellerOrderPayoutViewModelInput,
): SellerOrderPayoutViewModel {
  const signalInput: SellerPayoutSignalInput = {
    status: input.metadata.payoutStatus,
    destinationStatus: input.metadata.destinationStatus,
    retryAllowed: input.metadata.retryAllowed,
    manualReviewPending: input.metadata.manualReviewPending,
    verificationBlockers: input.metadata.verificationBlockers,
  };
  const launchMeta = getSellerPayoutLaunchStatusMeta(signalInput);
  const releaseCopy = releaseEligibilityCopy(input.metadata.releaseEligibility);

  return {
    payoutStatusLabel: getSellerPayoutStatusLabel(input.metadata.payoutStatus),
    payoutStatusDetail: launchMeta.detail,
    releaseEligibilityLabel: releaseCopy.label,
    releaseEligibilityDetail: releaseCopy.detail,
    paymentCapturedLabel: input.metadata.paymentCaptured ? "Captured" : "Pending confirmation",
    estimatedPayoutDate: formatDate(input.metadata.estimatedPayoutDate),
    payoutDestinationMask: normalizeMaskedDestination(input.metadata.payoutDestinationMask),
    nextStepGuidance:
      launchMeta.label === "Needs destination update"
        ? "Update or verify your destination so the payout can continue."
        : launchMeta.label === "Held"
          ? "The payout is held while admin review is in progress."
          : "Payouts are automatically queued after escrow release and admin review.",
  };
}
