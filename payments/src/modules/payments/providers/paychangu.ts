import { apiRequest } from '../../../shared/api/client.js';
import { ENDPOINTS } from '../../../shared/api/endpoints.js';
import type { CreatePaymentRequest, PaymentProviderCapabilities, PaymentResult, PaymentVerificationResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../types.js';
import type { PaymentGatewayProvider } from '../paymentGateway.js';

const capabilities: PaymentProviderCapabilities = {
  supportsWebhookVerification: true,
  supportsRefunds: false,
  supportsPartialCapture: false,
  supportedMethods: ['card', 'bank_transfer', 'mobile_money'],
  currencies: ['MWK', 'USD'],
};

const REFUND_UNAVAILABLE_MESSAGE = 'Refunds are not available yet for this payment provider';

function extractTxRef(payload: unknown): string {
  const p = payload as Record<string, unknown>;
  const txRef = p?.tx_ref ?? p?.txRef;
  if (!txRef) {
    throw new Error('Missing txRef in PayChangu payload');
  }
  return String(txRef);
}

export const paychanguProvider: PaymentGatewayProvider = {
  key: 'paychangu',
  capabilities,

  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    return apiRequest<PaymentResult>(ENDPOINTS.payments.paychangu.initialize, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  async verifyWebhook(_signature: string | undefined, payload: unknown): Promise<WebhookVerificationResult> {
    const txRef = extractTxRef(payload);
    const result = await apiRequest<PaymentVerificationResult>(ENDPOINTS.payments.paychangu.verify(txRef));
    return {
      valid: result.verified,
      provider: 'paychangu',
      reference: result.reference,
      payload,
    };
  },

  async refund(_request: RefundRequest): Promise<RefundResult> {
    throw new Error(REFUND_UNAVAILABLE_MESSAGE);
  },

  async parseWebhook(payload: unknown): Promise<WebhookVerificationResult> {
    const txRef = extractTxRef(payload);
    const result = await apiRequest<PaymentVerificationResult>(ENDPOINTS.payments.paychangu.verify(txRef));
    return {
      valid: result.verified,
      provider: 'paychangu',
      reference: result.reference,
      payload,
    };
  },
};
