import type { PaymentResult, PaymentVerificationResult } from '../../../src/modules/payments/types.js';
import type { CreatePaymentRequest } from '../../../src/modules/payments/types.js';
import type { OrderState } from '../../../src/modules/orders/orderState.js';
import { paymentRepository } from './payment.repository.js';
import { orderRepository } from '../orders/order.repository.js';
import { serverOrderService } from '../orders/order.service.js';
import { applyVerifiedPayChanguPayment } from './paychangu.flow.js';
import { paymentController } from './payment.controller.js';

export interface PayChanguFlowHarnessResult {
  orderBefore: OrderState;
  payment: PaymentResult;
  verification: PaymentVerificationResult;
  applied: Awaited<ReturnType<typeof applyVerifiedPayChanguPayment>>;
  orderAfter: Awaited<ReturnType<typeof orderRepository.findByIdAsync>>;
}

function buildSeedOrder(reference: string): OrderState {
  const now = new Date().toISOString();
  return {
    id: 'order_demo_001', buyerId: 'buyer_demo_001', sellerId: 'seller_demo_001', source: 'listing', status: 'draft', currency: 'MWK',
    subtotal: { amount: 50000, currency: 'MWK' }, total: { amount: 50000, currency: 'MWK' },
    items: [{ listingId: 'listing_demo_001', title: 'Demo item', quantity: 1, unitPrice: { amount: 50000, currency: 'MWK' } }],
    createdAt: now, updatedAt: now, paymentReference: reference, escrowId: 'escrow_demo_001',
  };
}

export async function runPayChanguFlowHarness(txRef: string): Promise<PayChanguFlowHarnessResult> {
  const orderBefore = buildSeedOrder(txRef);
  serverOrderService.create(orderBefore);
  const request: CreatePaymentRequest = {
    orderId: orderBefore.id, provider: 'paychangu', method: 'mobile_money', amount: orderBefore.total,
    customer: { id: orderBefore.buyerId, name: 'Demo Buyer', email: 'buyer@example.com', phoneNumber: '+265999000111' },
    returnUrl: 'https://example.com/return', cancelUrl: 'https://example.com/cancel', metadata: { orderSource: orderBefore.source },
  };
  const created = await paymentController.createPaychanguPayment(request);
  const verification: PaymentVerificationResult = {
    verified: true, provider: 'paychangu', txRef, reference: created.reference, status: 'captured', currency: orderBefore.total.currency,
    amount: orderBefore.total, checkoutUrl: created.checkoutUrl ?? null, rawResponse: created.rawResponse,
  };
  const applied = await applyVerifiedPayChanguPayment(verification);
  return { orderBefore, payment: created, verification, applied, orderAfter: await orderRepository.findByIdAsync(orderBefore.id) };
}

export function getStoredDemoPayment(reference: string) { return paymentRepository.findByReference(reference); }
