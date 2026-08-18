import type { EntityId, ISODateString, MoneyValue, Timestamped } from './common.js';
export type { MoneyValue } from './common.js';

export type PaymentProviderKey = 'paystack' | 'flutterwave' | 'paychangu';
export type PaymentMethod = 'card' | 'bank_transfer' | 'mobile_money' | 'ussd' | 'wallet';
export type CheckoutSettlementRoute = 'escrow' | 'connect';
export type PaymentIntentStatus = 'pending' | 'requires_action' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'refunded';
export type EscrowState = 'initiated' | 'funded' | 'held' | 'released' | 'refunded' | 'disputed' | 'closed';
export type SettlementStatus = 'pending' | 'processing' | 'settled' | 'failed';

export interface PaymentIntent extends Timestamped {
  id: EntityId;
  orderId: EntityId;
  provider: PaymentProviderKey;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  amount: MoneyValue;
  reference: string;
  customerId?: EntityId;
  metadata?: Record<string, unknown>;
  expiresAt?: ISODateString | null;
}

export interface PaymentTransaction extends Timestamped {
  id: EntityId;
  intentId: EntityId;
  providerReference: string;
  provider: PaymentProviderKey;
  status: SettlementStatus;
  amount: MoneyValue;
  fees?: MoneyValue;
  netAmount?: MoneyValue;
  paidAt?: ISODateString | null;
}

export interface EscrowLedgerEntry extends Timestamped {
  id: EntityId;
  escrowId: EntityId;
  entryType: 'debit' | 'credit' | 'hold' | 'release' | 'refund' | 'adjustment';
  amount: MoneyValue;
  balanceAfter: MoneyValue;
  note?: string;
  reference?: string;
}

export interface PayoutInstruction extends Timestamped {
  id: EntityId;
  sellerId: EntityId;
  paymentTransactionId: EntityId;
  amount: MoneyValue;
  provider: PaymentProviderKey;
  status: SettlementStatus;
  destination: {
    type: 'bank' | 'mobile_money' | 'wallet';
    maskedAccount?: string;
  };
}

export type SellerOrderPayoutStatus =
  | 'eligible'
  | 'queued'
  | 'processing'
  | 'pending'
  | 'held'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type SellerOrderReleaseEligibility =
  | 'eligible'
  | 'awaiting_release'
  | 'blocked'
  | 'not_applicable';

export interface SellerOrderPayoutMetadata {
  paymentCaptured: boolean;
  escrowState: string;
  releaseEligibility: SellerOrderReleaseEligibility;
  payoutStatus: SellerOrderPayoutStatus;
  estimatedPayoutDate?: ISODateString | null;
  payoutDestinationMask?: string | null;
  destinationStatus?: string | null;
  manualReviewPending?: boolean | null;
  retryAllowed?: boolean | null;
  verificationBlockers?: string[] | null;
}
