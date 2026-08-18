import assert from "node:assert/strict";
import test from "node:test";
import { getSellerPayoutLaunchStatusMeta, sellerOperationalSignals } from "../uiModel";

test("getSellerPayoutLaunchStatusMeta exposes launch-policy labels", () => {
  assert.equal(getSellerPayoutLaunchStatusMeta({ status: "queued" }).label, "Queued for admin review");
  assert.equal(getSellerPayoutLaunchStatusMeta({ status: "processing" }).label, "Sent to PayChangu");
  assert.equal(getSellerPayoutLaunchStatusMeta({ status: "pending" }).label, "Provider pending");
  assert.equal(getSellerPayoutLaunchStatusMeta({ status: "paid" }).label, "Paid");
  assert.equal(getSellerPayoutLaunchStatusMeta({ status: "held" }).label, "Held");
  assert.equal(getSellerPayoutLaunchStatusMeta({ status: "failed" }).label, "Needs destination update");
});

test("sellerOperationalSignals do not advertise manual seller withdrawals", () => {
  const copy = [
    ...sellerOperationalSignals({ status: "queued", manualReviewPending: true }),
    getSellerPayoutLaunchStatusMeta({ status: "queued" }).detail,
  ].join(" ").toLowerCase();

  assert.doesNotMatch(copy, /manual seller withdrawal/);
  assert.doesNotMatch(copy, /withdraw now/);
  assert.doesNotMatch(copy, /request withdrawal/);
  assert.match(copy, /admin/);
});
