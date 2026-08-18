import type { CreatePaymentRequest, PaymentResult, PaymentVerificationResult, RefundRequest, RefundResult, WebhookVerificationResult } from '../../../src/modules/payments/types.js';
import { serverPaymentService } from './payment.service.js';

export class PaymentController {
  createPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    return serverPaymentService.createPayment(request);
  }

  createPaychanguPayment(request: CreatePaymentRequest): Promise<PaymentResult> {
    return serverPaymentService.createPayment({ ...request, provider: 'paychangu' });
  }

  verifyPaychangu(txRef: string): Promise<PaymentVerificationResult> {
    return serverPaymentService.verifyPaychanguPayment(txRef);
  }

  refund(request: RefundRequest): Promise<RefundResult> {
    return serverPaymentService.refund(request);
  }

  verifyWebhook(providerKey: Parameters<typeof serverPaymentService.verifyWebhook>[0], signature: string | undefined, payload: unknown): Promise<WebhookVerificationResult> {
    return serverPaymentService.verifyWebhook(providerKey, signature, payload as string | Record<string, unknown>);
  }

  parseWebhook(providerKey: Parameters<typeof serverPaymentService.parseWebhook>[0], payload: unknown): Promise<WebhookVerificationResult> {
    return serverPaymentService.parseWebhook(providerKey, payload);
  }
}

export const paymentController = new PaymentController();
