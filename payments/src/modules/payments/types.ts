import type { EntityId, ISODateString, MoneyValue, Timestamped } from '../../shared/types/common.js';
import type { CheckoutSettlementRoute, PaymentMethod, PaymentProviderKey, PaymentIntentStatus, SettlementStatus } from '../../shared/types/payment.js';

export interface PaymentProviderCapabilities {
  supportsWebhookVerification: boolean;
  supportsRefunds: boolean;
  supportsPartialCapture: boolean;
  supportedMethods: PaymentMethod[];
  currencies: string[];
}

export interface PaymentCustomer {
  id?: EntityId;
  name: string;
  email?: string;
  phoneNumber?: string;
}

export interface CreatePaymentRequest {
  orderId: EntityId;
  provider: PaymentProviderKey;
  method: PaymentMethod;
  settlementRoute?: CheckoutSettlementRoute;
  amount: MoneyValue;
  customer: PaymentCustomer;
  metadata?: Record<string, unknown>;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface PaymentResult extends Timestamped {
  id: EntityId;
  orderId: EntityId;
  provider: PaymentProviderKey;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  amount: MoneyValue;
  reference: string;
  providerReference?: string | null;
  checkoutUrl?: string | null;
  paidAt?: ISODateString | null;
  rawResponse?: Record<string, unknown>;
}

export interface PaymentVerificationResult {
  verified: boolean;
  provider: PaymentProviderKey;
  txRef: string;
  reference?: string;
  orderId?: EntityId;
  status?: PaymentIntentStatus | SettlementStatus | string;
  failureReason?: string;
  currency?: string;
  amount?: MoneyValue;
  checkoutUrl?: string | null;
  rawResponse?: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  valid: boolean;
  provider: PaymentProviderKey;
  eventType?: string;
  reference?: string;
  signature?: string;
  payload: unknown;
}

export interface RefundRequest {
  paymentId: EntityId;
  provider: PaymentProviderKey;
  amount?: MoneyValue;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundResult extends Timestamped {
  id: EntityId;
  paymentId: EntityId;
  provider: PaymentProviderKey;
  status: SettlementStatus;
  amount: MoneyValue;
  reference: string;
}
