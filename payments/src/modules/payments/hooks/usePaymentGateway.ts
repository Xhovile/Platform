import { useMemo } from 'react';
import { paymentService, PaymentService } from '../services/paymentService.js';
import type { CreatePaymentRequest, PaymentResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../types.js';
import type { PaymentProviderKey } from '../../../shared/types/payment.js';

export interface UsePaymentGatewayResult {
  supportedProviders: PaymentProviderKey[];
  createPayment: (request: CreatePaymentRequest) => Promise<PaymentResult>;
  refund: (request: RefundRequest) => Promise<RefundResult>;
  verifyWebhook: (providerKey: PaymentProviderKey, signature: string | undefined, payload: unknown) => Promise<WebhookVerificationResult>;
  parseWebhook: (providerKey: PaymentProviderKey, payload: unknown) => Promise<WebhookVerificationResult>;
  getCapabilities: (providerKey: PaymentProviderKey) => ReturnType<PaymentService['getCapabilities']>;
  canRefund: (providerKey: PaymentProviderKey) => boolean;
}

export function usePaymentGateway(): UsePaymentGatewayResult {
  return useMemo(() => ({
    supportedProviders: paymentService.getSupportedProviders(),
    createPayment: (request) => paymentService.createPayment(request),
    refund: (request) => paymentService.refund(request),
    verifyWebhook: (providerKey, signature, payload) => paymentService.verifyWebhook(providerKey, signature, payload),
    parseWebhook: (providerKey, payload) => paymentService.parseWebhook(providerKey, payload),
    getCapabilities: (providerKey) => paymentService.getCapabilities(providerKey),
    canRefund: (providerKey) => paymentService.getCapabilities(providerKey).supportsRefunds,
  }), []);
}
