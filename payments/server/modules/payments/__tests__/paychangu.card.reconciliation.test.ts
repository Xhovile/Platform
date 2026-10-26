import test from "node:test";
import assert from "node:assert/strict";
import { verifyPayChanguDirectCardCharge } from "../paychangu.card.js";

test("stored card charges can be verified after new-charge gates are disabled", async () => {
  const result = await verifyPayChanguDirectCardCharge({
    chargeId: "BM-CARD-reconcile_123",
    expectedAmount: 1200,
    expectedCurrency: "MWK",
  }, {
    enabled: false,
    pciDssApproved: false,
    paychanguSecretKey: "test-secret",
    paychanguBaseUrl: "https://api.paychangu.com",
    fetcher: (async () => new Response(JSON.stringify({
      status: "success",
      data: {
        charge_id: "BM-CARD-reconcile_123",
        status: "success",
        amount: 1200,
        currency: "MWK",
      },
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
  });

  assert.equal(result.verified, true);
  assert.equal(result.status, "paid");
});
