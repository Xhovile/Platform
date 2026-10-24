import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectCardCheckout,
  verifyAndSettleDirectCardCharge,
} from "../paychangu.card.service.js";
import {
  clearPaymentState,
  refs,
} from "./paychangu.test.helpers.js";

const ENV_KEYS = [
  "PAYCHANGU_DIRECT_CARD_ENABLED",
  "PAYCHANGU_DIRECT_CARD_PCI_APPROVED",
  "PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED",
  "PAYCHANGU_SECRET_KEY",
  "PAYCHANGU_BASE_URL",
  "PAYCHANGU_DIRECT_CARD_RETURN_URL",
  "PAYCHANGU_DIRECT_CARD_RETURN_HOSTS",
  "PAYCHANGU_DIRECT_CARD_RESULT_URL",
  "PAYCHANGU_DIRECT_CARD_RESULT_HOSTS",
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setApprovedTestEnv(): void {
  process.env.PAYCHANGU_DIRECT_CARD_ENABLED = "true";
  process.env.PAYCHANGU_DIRECT_CARD_PCI_APPROVED = "true";
  process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED = "true";
  process.env.PAYCHANGU_SECRET_KEY = "integration-secret-key";
  process.env.PAYCHANGU_BASE_URL = "https://api.paychangu.com";
  process.env.PAYCHANGU_DIRECT_CARD_RETURN_URL = "https://api.example.test/api/payments/paychangu/direct-card/return";
  process.env.PAYCHANGU_DIRECT_CARD_RETURN_HOSTS = "api.example.test";
  process.env.PAYCHANGU_DIRECT_CARD_RESULT_URL = "https://buymesho.app/payment-return";
  process.env.PAYCHANGU_DIRECT_CARD_RESULT_HOSTS = "buymesho.app";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function seedUnpaidOrder(orderId: string): void {
  const now = new Date().toISOString();
  refs.serverOrderService.create({
    id: orderId,
    buyerId: "buyer_1",
    sellerId: "seller_1",
    source: "listing",
    status: "pending_payment",
    currency: "MWK",
    subtotal: { amount: 1000, currency: "MWK" },
    total: { amount: 1000, currency: "MWK" },
    items: [{
      kind: "listing",
      listingId: "listing_1",
      title: "Card test item",
      quantity: 1,
      unitPrice: { amount: 1000, currency: "MWK" },
    }],
    createdAt: now,
    updatedAt: now,
    paymentProvider: "paychangu",
    settlementRoute: "escrow",
  } as any);
}

test("direct-card flow persists a charge before initiation and settles only after provider verification", async () => {
  const savedEnv = saveEnv();
  const originalFetch = global.fetch;
  let submittedChargeId = "";

  clearPaymentState();
  setApprovedTestEnv();
  seedUnpaidOrder("order_direct_card_lifecycle_1");

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer integration-secret-key");

    if (target === "https://api.paychangu.com/charge-card/payments") {
      assert.equal(init?.method, "POST");
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      submittedChargeId = String(payload.charge_id ?? "");
      assert.match(submittedChargeId, /^BM-CARD-[0-9a-f]{32}$/);
      assert.equal(payload.amount, "1000.00");
      assert.equal(payload.currency, "MWK");
      assert.equal(payload.card_number, "4242424242424242");
      assert.equal(payload.cvv, "123");
      return jsonResponse({
        success: true,
        requires_3ds_auth: true,
        orderReference: "provider-order-ref-1",
        "3ds_auth_link": "https://in.paychangu.com/3ds/auth?reference=test",
      });
    }

    if (target.startsWith("https://api.paychangu.com/charge-card/verify/")) {
      assert.equal(init?.method, "GET");
      const chargeId = decodeURIComponent(target.split("/").pop() ?? "");
      return jsonResponse({
        status: "success",
        data: {
          charge_id: chargeId,
          status: "success",
          amount: 1000,
          currency: "MWK",
        },
      });
    }

    return jsonResponse({ success: false }, 404);
  }) as typeof fetch;

  try {
    const initiated = await createDirectCardCheckout({
      orderId: "order_direct_card_lifecycle_1",
      buyerId: "buyer_1",
      amount: 1000,
      currency: "MWK",
      email: "buyer@example.com",
      card: {
        cardNumber: "4242 4242 4242 4242",
        expiry: "12/30",
        cvv: "123",
        cardholderName: "Test Buyer",
      },
    });

    assert.equal(initiated.requiresAction, true);
    assert.equal(initiated.paymentVerified, false);
    assert.equal(initiated.charge.status, "requires_action");
    assert.equal(initiated.payment.status, "requires_action");
    assert.equal(initiated.charge.chargeId, submittedChargeId);
    assert.ok(initiated.payment.reference);
    assert.equal(initiated.charge.paymentReference, initiated.payment.reference);

    const storedPayment = refs.paymentRepository.findByReference(initiated.payment.reference);
    assert.ok(storedPayment);
    const serializedStoredData = JSON.stringify({ payment: storedPayment, charge: initiated.charge });
    assert.equal(serializedStoredData.includes("4242424242424242"), false);
    assert.equal(serializedStoredData.includes('"cvv":"123"'), false);
    assert.equal(serializedStoredData.includes("Test Buyer"), false);

    const orderBeforeVerification = refs.orderRepository.findById("order_direct_card_lifecycle_1");
    assert.equal(orderBeforeVerification?.status, "pending_payment");

    const verified = await verifyAndSettleDirectCardCharge(submittedChargeId);
    assert.equal(verified.verified, true);
    assert.equal(verified.status, "paid");
    assert.equal(verified.charge.status, "paid");
    assert.equal(verified.payment.status, "captured");
    assert.equal(verified.payment.verified, true);

    const settledOrder = refs.orderRepository.findById("order_direct_card_lifecycle_1");
    assert.ok(settledOrder);
    assert.notEqual(settledOrder.status, "pending_payment");
    assert.equal(settledOrder.paymentReference, initiated.payment.reference);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(savedEnv);
    clearPaymentState();
  }
});

test("direct-card checkout remains blocked until PayChangu's validation contract is confirmed", async () => {
  const savedEnv = saveEnv();
  const originalFetch = global.fetch;
  clearPaymentState();
  setApprovedTestEnv();
  delete process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED;
  seedUnpaidOrder("order_direct_card_validation_gate_1");
  global.fetch = (async () => {
    throw new Error("Provider must not be called while the validation contract is unresolved.");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => createDirectCardCheckout({
        orderId: "order_direct_card_validation_gate_1",
        buyerId: "buyer_1",
        amount: 1000,
        currency: "MWK",
        email: "buyer@example.com",
        card: {
          cardNumber: "4242 4242 4242 4242",
          expiry: "12/30",
          cvv: "123",
          cardholderName: "Test Buyer",
        },
      }),
      /blocked until PayChangu's validate-charge\/3-D Secure contract is confirmed/,
    );

    assert.equal(Boolean(refs.orderRepository.findById("order_direct_card_validation_gate_1")?.paymentReference), false);
    const count = refs.getPaymentDb().prepare("SELECT COUNT(*) AS count FROM payments").get() as { count: number };
    assert.equal(Number(count.count), 0);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(savedEnv);
    clearPaymentState();
  }
});

test("direct-card checkout fails closed when compliance/account gates are not enabled", async () => {
  const savedEnv = saveEnv();
  const originalFetch = global.fetch;
  clearPaymentState();
  setApprovedTestEnv();
  process.env.PAYCHANGU_DIRECT_CARD_PCI_APPROVED = "false";
  seedUnpaidOrder("order_direct_card_disabled_1");
  global.fetch = (async () => {
    throw new Error("Provider must not be called when the feature gate is closed.");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => createDirectCardCheckout({
        orderId: "order_direct_card_disabled_1",
        buyerId: "buyer_1",
        amount: 1000,
        currency: "MWK",
        email: "buyer@example.com",
        card: {
          cardNumber: "4242 4242 4242 4242",
          expiry: "12/30",
          cvv: "123",
          cardholderName: "Test Buyer",
        },
      }),
      /requires confirmed PCI DSS approval and PayChangu account activation/,
    );

    assert.equal(Boolean(refs.orderRepository.findById("order_direct_card_disabled_1")?.paymentReference), false);
    const count = refs.getPaymentDb().prepare("SELECT COUNT(*) AS count FROM payments").get() as { count: number };
    assert.equal(Number(count.count), 0);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(savedEnv);
    clearPaymentState();
  }
});
