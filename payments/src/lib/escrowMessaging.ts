export type EscrowMessageState = {
  orderStatus?: string | null;
  escrowState?: string | null;
  paymentStatus?: string | null;
};

export function getEscrowHeadline(state: EscrowMessageState): string {
  if (state.escrowState === 'released') {
    return 'Funds released to seller';
  }

  if (state.escrowState === 'refunded') {
    return 'Funds refunded to buyer';
  }

  if (state.escrowState === 'disputed') {
    return 'Escrow currently under dispute review';
  }

  if (
    state.orderStatus === 'in_escrow' ||
    state.escrowState === 'funded' ||
    state.escrowState === 'held'
  ) {
    return 'Funds secured in BuyMesho Escrow';
  }

  if (state.paymentStatus === 'pending') {
    return 'Awaiting payment verification';
  }

  return 'Order processing in progress';
}

export function getEscrowDescription(state: EscrowMessageState): string {
  if (state.escrowState === 'released') {
    return 'The seller has received the payment after delivery confirmation.';
  }

  if (state.escrowState === 'refunded') {
    return 'The escrow was reversed and the buyer refund process has started.';
  }

  if (state.escrowState === 'disputed') {
    return 'BuyMesho is reviewing the dispute before funds are released or refunded.';
  }

  if (
    state.orderStatus === 'in_escrow' ||
    state.escrowState === 'funded' ||
    state.escrowState === 'held'
  ) {
    return 'The seller cannot access the funds until delivery is confirmed or the dispute process is resolved.';
  }

  if (state.paymentStatus === 'pending') {
    return 'BuyMesho is waiting for payment confirmation from the payment provider webhook.';
  }

  return 'Your order is currently being processed.';
}

export function getSellerPayoutLabel(state: EscrowMessageState): string {
  if (state.escrowState === 'released') {
    return 'Seller payout completed';
  }

  if (state.escrowState === 'refunded') {
    return 'Seller payout cancelled';
  }

  if (state.escrowState === 'disputed') {
    return 'Seller payout paused during dispute';
  }

  return 'Seller payout waiting for escrow release';
}
