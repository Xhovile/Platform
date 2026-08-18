import assert from "node:assert/strict";
import test from "node:test";
import { buildSellerOrderPayoutViewModel } from "../orderPayoutViewModel";

test("order payout view model masks destination and hides sensitive internal fields", () => {
  const rawAccountNumber = "0999123456";
  const providerError = "provider timeout with gateway trace 9281";
  const adminNotes = "internal: flagged by reconciliation";

  const model = buildSellerOrderPayoutViewModel({
    metadata: {
      paymentCaptured: true,
      escrowState: "released",
      releaseEligibility: "eligible",
      payoutStatus: "failed",
      estimatedPayoutDate: "2026-05-20T10:00:00.000Z",
      payoutDestinationMask: rawAccountNumber,
      destinationStatus: "failed",
      manualReviewPending: true,
      retryAllowed: false,
      verificationBlockers: ["destination_name_mismatch"],
    },
    providerError,
    adminNotes,
  });

  assert.equal(model.payoutDestinationMask, "•••• 3456");
  assert.doesNotMatch(JSON.stringify(model), new RegExp(rawAccountNumber));
  assert.doesNotMatch(JSON.stringify(model), /provider timeout/i);
  assert.doesNotMatch(JSON.stringify(model), /internal: flagged/i);
});

test("order payout view model gives seller-safe guidance for held and destination issues", () => {
  const heldModel = buildSellerOrderPayoutViewModel({
    metadata: {
      paymentCaptured: true,
      escrowState: "held",
      releaseEligibility: "blocked",
      payoutStatus: "held",
      payoutDestinationMask: "•••• 1234",
    },
  });
  assert.match(heldModel.nextStepGuidance, /held/i);

  const updateModel = buildSellerOrderPayoutViewModel({
    metadata: {
      paymentCaptured: true,
      escrowState: "released",
      releaseEligibility: "eligible",
      payoutStatus: "failed",
      payoutDestinationMask: "123456789",
      destinationStatus: "failed",
    },
  });
  assert.match(updateModel.nextStepGuidance, /update or verify/i);
});
