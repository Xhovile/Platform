export const PAYOUT_POLICY = {
  platformFeeBps: 300,
  payoutFeeBps: {
    airtel_money: 300,
    tnm_mpamba: 300,
    bank_transfer: 300,
  },
  bankPayoutFlatFeeAmount: 0,
  buyerFeeBps: 0,
  payChanguCustomerFeeBps: 0,
  reserveCapBps: 600,
  disputeWindowHours: 72,
  // Allow low-value orders to disburse instead of being held for manual review.
  // Keep this at 1 (smallest whole-money unit persisted by the current model).
  minimumPayoutAmount: 1,
  maxRetryCount: 3,
  launchMode: 'admin_approved' as const,
  retryableFailureCodes: new Set([
    'provider_timeout',
    'provider_unavailable',
    'provider_network_error',
    'provider_rate_limited',
    'balance_insufficient',
  ]),
  nonRetryableFailureCodes: new Set([
    'destination_not_verified',
    'destination_inactive',
    'seller_suspended',
    'order_disputed',
    'order_not_releasable',
    'payment_not_captured',
    'manual_review_required',
    'payout_not_found',
    'payout_cancelled',
  ]),
} as const;

export type PayoutLaunchMode = typeof PAYOUT_POLICY.launchMode;

export type PayoutFormulaInput = {
  grossAmount: number;
  processingFeeAmount?: number;
  reserveAmount?: number;
  manualAdjustmentAmount?: number;
  payoutMethod?: 'airtel_money' | 'tnm_mpamba' | 'bank_transfer' | null;
  currency?: string;
};

export type CustomerCheckoutFeeInput = {
  itemTotalAmount: number;
  currency?: string;
};

export type CustomerCheckoutFeeBreakdown = {
  itemTotalAmount: number;
  buyerFeeAmount: number;
  payChanguTransactionFeeAmount: number;
  finalTotalAmount: number;
  currency: string;
};

export type PayoutFormulaResult = {
  grossAmount: number;
  platformFeeAmount: number;
  processingFeeAmount: number;
  reserveAmount: number;
  reserveCapAmount: number;
  manualAdjustmentAmount: number;
  payoutFeeAmount: number;
  sellerReceivesAmount: number;
  netAmount: number;
  currency: string;
};

export function toFixedMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount));
}

export function calculateCustomerCheckoutFees(input: CustomerCheckoutFeeInput): CustomerCheckoutFeeBreakdown {
  const itemTotalAmount = toFixedMoney(input.itemTotalAmount);
  const buyerFeeAmount = toFixedMoney((itemTotalAmount * PAYOUT_POLICY.buyerFeeBps) / 10_000);
  const payChanguTransactionFeeAmount = 0;
  const finalTotalAmount = toFixedMoney(itemTotalAmount + buyerFeeAmount);

  return {
    itemTotalAmount,
    buyerFeeAmount,
    payChanguTransactionFeeAmount,
    finalTotalAmount,
    currency: (input.currency ?? 'MWK').toUpperCase(),
  };
}

export function calculatePayoutFee(amount: number, payoutMethod?: PayoutFormulaInput['payoutMethod']): number {
  const payoutAmount = toFixedMoney(amount);
  if (!payoutMethod) return 0;

  const variableFee = toFixedMoney((payoutAmount * PAYOUT_POLICY.payoutFeeBps[payoutMethod]) / 10_000);
  const flatFee = payoutMethod === 'bank_transfer' ? PAYOUT_POLICY.bankPayoutFlatFeeAmount : 0;
  return toFixedMoney(variableFee + flatFee);
}

export function calculatePayoutFormula(input: PayoutFormulaInput): PayoutFormulaResult {
  const grossAmount = toFixedMoney(input.grossAmount);
  const manualAdjustmentAmount = toFixedMoney(input.manualAdjustmentAmount ?? 0);
  const reserveCapAmount = toFixedMoney((grossAmount * PAYOUT_POLICY.reserveCapBps) / 10_000);
  const requestedReserveAmount = toFixedMoney(input.reserveAmount ?? 0);
  const reserveAmount = Math.min(requestedReserveAmount, reserveCapAmount);
  const platformFeeAmount = toFixedMoney((grossAmount * PAYOUT_POLICY.platformFeeBps) / 10_000);

  // Customer-paid transaction fees are handled at checkout, not in seller payout math.
  // Keep this field for compatibility, but it is no longer part of the payout formula.
  const processingFeeAmount = 0;

  const amountBeforePayoutFee = Math.max(
    0,
    toFixedMoney(
      grossAmount -
        platformFeeAmount -
        reserveAmount -
        manualAdjustmentAmount,
    ),
  );
  // PayChangu mobile-money transaction fee is withheld from the item total,
  // alongside BuyMesho's commission, before funds are requested for seller payout.
  const payoutFeeAmount = calculatePayoutFee(grossAmount, input.payoutMethod ?? null);
  const netAmount = Math.max(0, toFixedMoney(amountBeforePayoutFee - payoutFeeAmount));
  const sellerReceivesAmount = netAmount;

  return {
    grossAmount,
    platformFeeAmount,
    processingFeeAmount,
    reserveAmount,
    reserveCapAmount,
    manualAdjustmentAmount,
    payoutFeeAmount,
    sellerReceivesAmount,
    netAmount,
    currency: (input.currency ?? 'MWK').toUpperCase(),
  };
}

export function isRetryableFailureCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return PAYOUT_POLICY.retryableFailureCodes.has(code);
}

export function isNonRetryableFailureCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return PAYOUT_POLICY.nonRetryableFailureCodes.has(code);
}
