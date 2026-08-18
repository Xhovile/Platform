import { apiRequest } from '../../../shared/api/client.js';
import { ENDPOINTS } from '../../../shared/api/endpoints.js';
import { PaymentGatewayRegistry } from '../paymentGateway.js';
import { flutterwaveProvider } from '../providers/flutterwave.js';
import { paychanguProvider } from '../providers/paychangu.js';
import { paystackProvider } from '../providers/paystack.js';
import type { CreatePaymentRequest, PaymentResult, PaymentVerificationResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../types.js';
import type { PaymentProviderKey } from '../../../shared/types/payment.js';
import { ApiError } from '../../../shared/api/errors.js';

export class PaymentService {
  constructor(private readonly registry = PaymentService.createDefaultRegistry()) {}

  static createDefaultRegistry(): PaymentGatewayRegistry {
    const registry = new PaymentGatewayRegistry();
    registry.register(paystackProvider);
    registry.register(flutterwaveProvider);
    registry.register(paychanguProvider);
    return registry;
  }

  getSupportedProviders(): PaymentProviderKey[] {
    return this.registry.list();
  }

  getCapabilities(providerKey: PaymentProviderKey) {
    return this.registry.get(providerKey).capabilities;
  }

  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    return this.registry.get(request.provider).createPayment(request);
  }

  async verifyPaychanguPayment(txRef: string): Promise<PaymentVerificationResult> {
    const result = await apiRequest<PaymentVerificationResult>(ENDPOINTS.payments.paychangu.verify(txRef));

    return {
      ...result,
      txRef: result.txRef || txRef,
      provider: 'paychangu',
      reference: result.reference ?? txRef,
      verified: Boolean(result.verified),
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const provider = this.registry.get(request.provider);

    if (!provider.capabilities.supportsRefunds) {
      throw new ApiError(`Refunds are not supported for provider: ${request.provider}`, {
        code: 'REFUNDS_UNSUPPORTED',
        status: 501,
      });
    }

    return provider.refund(request);
  }

  async verifyWebhook(providerKey: PaymentProviderKey, signature: string | undefined, payload: unknown): Promise<WebhookVerificationResult> {
    return this.registry.get(providerKey).verifyWebhook(signature, payload);
  }

  async parseWebhook(providerKey: PaymentProviderKey, payload: unknown): Promise<WebhookVerificationResult> {
    return this.registry.get(providerKey).parseWebhook(payload);
  }
}

export const paymentService = new PaymentService();
