import assert from "node:assert/strict";
import test from "node:test";
import { classifyPayoutDiagnostic } from "../diagnostics";
import type { PayoutRow } from "../../../AdminPayoutsManager";

function basePayout(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: "payout-1",
    sellerId: "seller-1",
    orderId: "order-1",
    escrowId: "escrow-1",
    releaseEntryId: "release-1",
    amount: 1000,
    currency: "MWK",
    status: "pending_settlement",
    provider: "paychangu",
    providerChargeId: null,
    providerReference: null,
    providerStatus: null,
    destinationAccountId: "destination-1",
    destinationMaskedAccount: "****1234",
    destinationType: "mobile_money",
    destinationVerificationStatus: "verified",
    destinationActive: true,
    failureReason: null,
    manualReviewReason: null,
    requestedBy: "buyer-1",
    requestedAt: "2026-08-15T00:00:00.000Z",
    sentAt: null,
    paidAt: null,
    failedAt: null,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    latestAttemptNo: null,
    latestAttemptStatus: null,
    latestAttemptAt: null,
    ...overrides,
  };
}

test("pending settlement payout with verified destination is lifecycle, not missing attempt", () => {
  const diagnostic = classifyPayoutDiagnostic(basePayout());

  assert.equal(diagnostic.classification, "lifecycle");
  assert.equal(diagnostic.label, "Payout lifecycle");
});

test("processing payout with verified destination and no attempt remains reconciliation issue", () => {
  const diagnostic = classifyPayoutDiagnostic(basePayout({ status: "processing", currentState: "processing" }));

  assert.equal(diagnostic.classification, "reconciliation");
  assert.match(diagnostic.message ?? "", /no provider attempt/i);
});
