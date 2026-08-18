import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYOUT_POLICY,
  calculateCustomerCheckoutFees,
  calculatePayoutFormula,
  isNonRetryableFailureCode,
  isRetryableFailureCode,
} from '../payout.policy.js';

test('payout policy freezes the seller-net formula and hard caps reserves', () => {
  const formula = calculatePayoutFormula({
    grossAmount: 1500,
    processingFeeAmount: 10,
    reserveAmount: 200,
    manualAdjustmentAmount: 20,
    payoutMethod: 'bank_transfer',
    currency: 'mwk',
  });

  assert.equal(PAYOUT_POLICY.platformFeeBps, 300);
  assert.equal(PAYOUT_POLICY.reserveCapBps, 600);
  assert.equal(PAYOUT_POLICY.disputeWindowHours, 72);
  assert.equal(PAYOUT_POLICY.minimumPayoutAmount, 1);
  assert.equal(PAYOUT_POLICY.maxRetryCount, 3);
  assert.equal(PAYOUT_POLICY.launchMode, 'admin_approved');

  assert.equal(formula.grossAmount, 1500);
  assert.equal(formula.platformFeeAmount, 45);

  // Customer-paid transaction fees are excluded from seller payout math.
  assert.equal(formula.processingFeeAmount, 0);

  assert.equal(formula.reserveCapAmount, 90);
  assert.equal(formula.reserveAmount, 90, 'reserve must be capped at 6% of gross');
  assert.equal(formula.manualAdjustmentAmount, 20);

  // 1500 - 45 - 90 - 20 = 1345 before provider fees; 3% PayChangu fee is deducted from gross.
  assert.equal(formula.payoutFeeAmount, 45, 'PayChangu payout fee must be 3% of gross');
  assert.equal(formula.netAmount, 1300, 'seller net payout must deduct commission and PayChangu transaction fee');
  assert.equal(formula.sellerReceivesAmount, 1300, 'seller receives the net payout after payout transfer fee');
  assert.equal(formula.currency, 'MWK');
});

test('checkout fee breakdown does not charge BuyMesho platform fees to customers', () => {
  const checkout = calculateCustomerCheckoutFees({
    itemTotalAmount: 10000,
    currency: 'mwk',
  });

  assert.equal(checkout.itemTotalAmount, 10000);
  assert.equal(checkout.buyerFeeAmount, 0);
  assert.equal(checkout.payChanguTransactionFeeAmount, 0);
  assert.equal(checkout.finalTotalAmount, 10000);
  assert.equal(checkout.currency, 'MWK');
});

test('payout policy separates retryable and non-retryable failure codes', () => {
  assert.equal(isRetryableFailureCode('provider_timeout'), true);
  assert.equal(isRetryableFailureCode('provider_unavailable'), true);
  assert.equal(isRetryableFailureCode('provider_network_error'), true);
  assert.equal(isRetryableFailureCode('provider_rate_limited'), true);
  assert.equal(isRetryableFailureCode('balance_insufficient'), true);

  assert.equal(isRetryableFailureCode('order_disputed'), false);
  assert.equal(isNonRetryableFailureCode('order_disputed'), true);
  assert.equal(isNonRetryableFailureCode('destination_inactive'), true);
  assert.equal(isNonRetryableFailureCode('payment_not_captured'), true);
  assert.equal(isNonRetryableFailureCode('provider_unavailable'), false);
});
