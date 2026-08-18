import type { CreatePaymentRequest, PaymentProviderCapabilities, PaymentResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../types.js';
import type { PaymentGatewayProvider } from '../paymentGateway.js';

const capabilities: PaymentProviderCapabilities = {
  supportsWebhookVerification: true,
  supportsRefunds: true,
  supportsPartialCapture: false,
  supportedMethods: ['card', 'bank_transfer', 'mobile_money'],
  currencies: ['NGN', 'USD', 'GHS', 'ZAR', 'KES', 'MWK'],
};

export const paystackProvider: PaymentGatewayProvider = {
  key: 'paystack',
  capabilities,

  async createPayment(_request: CreatePaymentRequest): Promise<PaymentResult> {
    throw new Error('Paystack adapter not implemented yet');
  },

  async verifyWebhook(_signature: string | undefined, _payload: unknown): Promise<WebhookVerificationResult> {
    throw new Error('Paystack webhook verification not implemented yet');
  },

  async refund(_request: RefundRequest): Promise<RefundResult> {
    throw new Error('Paystack refund flow not implemented yet');
  },

  async parseWebhook(payload: unknown): Promise<WebhookVerificationResult> {
    return {
      valid: false,
      provider: 'paystack',
      payload,
    };
  },
};
