import type { PaymentProviderKey, PaymentMethod, PaymentIntentStatus, EscrowState } from '../types/payment';

export const SUPPORTED_PAYMENT_PROVIDERS: PaymentProviderKey[] = ['paystack', 'flutterwave', 'paychangu'];
export const SUPPORTED_PAYMENT_METHODS: PaymentMethod[] = ['card', 'bank_transfer', 'mobile_money', 'ussd', 'wallet'];
export const PAYMENT_INTENT_STATUSES: PaymentIntentStatus[] = ['pending', 'requires_action', 'authorized', 'captured', 'failed', 'cancelled'];
export const ESCROW_STATES: EscrowState[] = ['initiated', 'funded', 'held', 'released', 'refunded', 'disputed', 'closed'];
export const DEFAULT_CURRENCY_PRECISION = 2;
export const DEFAULT_ESCROW_RELEASE_WINDOW_HOURS = 72;
export const DEFAULT_RETRY_LIMIT = 3;
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const WEBHOOK_SIGNATURE_HEADER = 'X-Signature';
