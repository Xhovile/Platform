import type { CreatePaymentRequest, PaymentProviderCapabilities, PaymentResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../types.js';
import type { PaymentGatewayProvider } from '../paymentGateway.js';

const capabilities: PaymentProviderCapabilities = {
  supportsWebhookVerification: true,
  supportsRefunds: true,
  supportsPartialCapture: true,
  supportedMethods: ['card', 'bank_transfer', 'mobile_money', 'ussd', 'wallet'],
  currencies: ['NGN', 'USD', 'GHS', 'ZAR', 'KES', 'MWK'],
};

export const flutterwaveProvider: PaymentGatewayProvider = {
  key: 'flutterwave',
  capabilities,

  async createPayment(_request: CreatePaymentRequest): Promise<PaymentResult> {
    throw new Error('Flutterwave adapter not implemented yet');
  },

  async verifyWebhook(_signature: string | undefined, _payload: unknown): Promise<WebhookVerificationResult> {
    throw new Error('Flutterwave webhook verification not implemented yet');
  },

  async refund(_request: RefundRequest): Promise<RefundResult> {
    throw new Error('Flutterwave refund flow not implemented yet');
  },

  async parseWebhook(payload: unknown): Promise<WebhookVerificationResult> {
    return {
      valid: false,
      provider: 'flutterwave',
      payload,
    };
  },
};
