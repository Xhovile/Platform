export type DestinationType = "mobile_money" | "bank";

export type PayoutStatus =
  | "eligible"
  | "pending_settlement"
  | "ready_for_payout"
  | "queued"
  | "processing"
  | "pending"
  | "held"
  | "paid"
  | "failed"
  | "cancelled";

export type PayoutDestination = {
  id: string;
  sellerId: string;
  destinationType: DestinationType;
  providerName: string;
  providerRefId: string | null;
  currency: string;
  accountName: string;
  maskedAccount: string;
  isDefault: boolean;
  verificationStatus: string;
  verificationAttempts: number;
  lastError: string | null;
  verifiedAt: string | null;
  replacedFromId: string | null;
  replacedById: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SellerPayoutLaunchStatus =
  | 'eligible'
  | 'pending_settlement'
  | 'ready_for_payout'
  | 'queued_for_admin_review'
  | 'sent_to_paychangu'
  | 'provider_pending'
  | 'paid'
  | 'held'
  | 'needs_destination_update'
  | 'cancelled';

export type PayoutRecord = {
  id: string;
  sellerId: string;
  orderId: string | null;
  escrowId: string | null;
  releaseEntryId: string | null;
  amount: number;
  currency: string;
  grossAmount?: number | null;
  platformFeeAmount?: number | null;
  reserveAmount?: number | null;
  manualAdjustmentAmount?: number | null;
  payoutFeeAmount?: number | null;
  sellerReceivesAmount?: number | null;
  netAmount?: number | null;
  status: PayoutStatus;
  provider: string | null;
  providerChargeId: string | null;
  providerStatus?: string | null;
  destinationStatus?: string;
  holdReason?: string | null;
  lastFailureReason?: string | null;
  retryAllowed?: boolean;
  retryEligible?: boolean | null;
  retryBlockedReason?: string | null;
  retryCount?: number;
  manualReviewPending?: boolean;
  manualReviewReason?: string | null;
  verificationBlockers?: string[];
  destinationVerificationStatus?: string | null;
  lastUpdatedTimestamp?: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayoutPermissions = {
  viewPayoutSettings: boolean;
  editPayoutSettings: boolean;
  requestWithdrawal: boolean;
  viewPayoutHistory: boolean;
  requestPayoutRetry: boolean;
  approveOverride: boolean;
};

export type PayoutDestinationFormState = {
  destinationType: DestinationType;
  providerName: string;
  providerRefId: string;
  currency: string;
  accountName: string;
  accountNumber: string;
  mobile: string;
  isDefault: boolean;
};

export type PayoutDestinationPayload = {
  sellerUid: string;
  destinationType: DestinationType;
  providerName: string;
  providerRefId?: string;
  currency: string;
  accountName: string;
  accountNumber?: string;
  mobile?: string;
  isDefault: boolean;
};

export type PayoutSummary = {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  activeDestinations: number;
  defaultDestination: PayoutDestination | null;
};

export type SellerFacingPayoutSummary = {
  title: string;
  detail: string;
};

export type PayoutProviderOption = {
  id: string;
  name: string;
  destinationType: DestinationType;
  providerRefId?: string | null;
  currency?: string | null;
};

export type PayoutProviderMetadata = {
  mobileMoneyOperators: PayoutProviderOption[];
  banks: PayoutProviderOption[];
  currencies: string[];
};
