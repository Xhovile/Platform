import type { CreatePaymentRequest, PaymentProviderCapabilities, PaymentResult, RefundRequest, RefundResult, WebhookVerificationResult } from './types.js';
import type { PaymentProviderKey } from '../../shared/types/payment.js';

export interface PaymentGatewayProvider {
  readonly key: PaymentProviderKey;
  readonly capabilities: PaymentProviderCapabilities;

  createPayment(request: CreatePaymentRequest): Promise<PaymentResult>;
  verifyWebhook(signature: string | undefined, payload: unknown): Promise<WebhookVerificationResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  parseWebhook(payload: unknown): Promise<WebhookVerificationResult>;
}

export class PaymentGatewayRegistry {
  private readonly providers = new Map<PaymentProviderKey, PaymentGatewayProvider>();

  register(provider: PaymentGatewayProvider): void {
    this.providers.set(provider.key, provider);
  }

  get(providerKey: PaymentProviderKey): PaymentGatewayProvider {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new Error(`Payment provider not registered: ${providerKey}`);
    }
    return provider;
  }

  has(providerKey: PaymentProviderKey): boolean {
    return this.providers.has(providerKey);
  }

  list(): PaymentProviderKey[] {
    return [...this.providers.keys()];
  }
}
