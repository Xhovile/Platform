import type { OrderStatus } from '../../../src/modules/orders/orderState.js';
import type { EscrowState } from '../../../src/shared/types/payment.js';

export interface EscrowReleaseReadinessContext {
  orderStatus: OrderStatus;
  escrowState: EscrowState;
  balanceAmount: number;
  paymentCaptured: boolean;
  disputeOpened?: boolean;
}

export interface EscrowReleaseReadinessResult {
  releasable: boolean;
  payoutEligible: boolean;
  reason: string;
}

export function evaluateEscrowReleaseReadiness(
  context: EscrowReleaseReadinessContext,
): EscrowReleaseReadinessResult {
  if (context.disputeOpened) {
    return {
      releasable: false,
      payoutEligible: false,
      reason: 'Escrow is under dispute.',
    };
  }

  if (
    context.escrowState === 'released' ||
    context.escrowState === 'refunded' ||
    context.escrowState === 'closed'
  ) {
    return {
      releasable: false,
      payoutEligible: false,
      reason: 'Escrow is already settled.',
    };
  }

  if (context.balanceAmount <= 0) {
    return {
      releasable: false,
      payoutEligible: false,
      reason: 'Escrow has no held balance to release.',
    };
  }

  if (!context.paymentCaptured) {
    return {
      releasable: false,
      payoutEligible: false,
      reason: 'Payment has not been captured yet.',
    };
  }

  const isOrderReleaseReady =
    context.orderStatus === 'paid' ||
    context.orderStatus === 'in_escrow' ||
    context.orderStatus === 'fulfilled';

  if (!isOrderReleaseReady) {
    return {
      releasable: false,
      payoutEligible: false,
      reason: `Order is not ready for escrow release from ${context.orderStatus} state.`,
    };
  }

  return {
    releasable: true,
    payoutEligible: true,
    reason: 'Escrow release gate passed.',
  };
}

export function canRelease(context: EscrowReleaseReadinessContext): boolean {
  return evaluateEscrowReleaseReadiness(context).releasable;
}

export function assertEscrowReleaseReadiness(
  context: EscrowReleaseReadinessContext,
): EscrowReleaseReadinessResult {
  return evaluateEscrowReleaseReadiness(context);
}