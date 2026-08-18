import type { EscrowState } from '../../shared/types/payment';

export interface ReleaseRuleContext {
  state: EscrowState;
  fundsHeld: boolean;
  buyerConfirmed: boolean;
  sellerConfirmed: boolean;
  deliveryConfirmed: boolean;
  disputeOpened: boolean;
  holdDaysElapsed: number;
}

export interface ReleaseRuleResult {
  releasable: boolean;
  reason: string;
}

export function evaluateReleaseRule(context: ReleaseRuleContext): ReleaseRuleResult {
  if (context.disputeOpened) {
    return { releasable: false, reason: 'Escrow is under dispute.' };
  }

  if (context.state === 'released' || context.state === 'refunded' || context.state === 'closed') {
    return { releasable: false, reason: 'Escrow is already settled.' };
  }

  if (!context.fundsHeld) {
    return { releasable: false, reason: 'Funds are not yet held in escrow.' };
  }

  if (context.buyerConfirmed || context.sellerConfirmed || context.deliveryConfirmed) {
    return { releasable: true, reason: 'A release condition has been satisfied.' };
  }

  if (context.holdDaysElapsed >= 7) {
    return { releasable: true, reason: 'Hold period elapsed.' };
  }

  return { releasable: false, reason: 'No release condition met yet.' };
}
