import test from "node:test";
import assert from "node:assert/strict";
import {
  createPayChanguDirectCardService,
  type DirectCardServiceDependencies,
} from "../paychangu.card.service.js";
import type {
  DirectCardCheckoutStore,
  DirectCardOrderSnapshot,
  DirectCardPaymentSummary,
  StoredPayChanguCardCharge,
  DirectCardChargePatch,
  DirectCardAuthorizationAdapter,
} from "../paychangu.card.contracts.js";

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

function setTestEnv(): void {
  process.env.PAYCHANGU_DIRECT_CARD_ENABLED = "true";
  process.env.PAYCHANGU_DIRECT_CARD_PCI_APPROVED = "true";
  process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED = "true";
  process.env.PAYCHANGU_SECRET_KEY = "test-secret";
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

class FakeDirectCardStore implements DirectCardCheckoutStore {
  readonly order: DirectCardOrderSnapshot = {
    id: "order_card_test_1",
    buyerId: "buyer_1",
    status: "pending_payment",
    amount: 1000,
    currency: "MWK",
    paymentReference: null,
  };

  readonly charges = new Map<string, StoredPayChanguCardCharge>();
  readonly payments = new Map<string, DirectCardPaymentSummary>();
  settlementCount = 0;

  async getOrder(orderId: string, buyerId: string): Promise<DirectCardOrderSnapshot | null> {
    if (this.order.id !== orderId || this.order.buyerId !== buyerId) return null;
    return { ...this.order };
  }

  async createPendingCharge(input: {
    order: DirectCardOrderSnapshot;
    id: string;
    chargeId: string;
    paymentReference: string;
    resultUrl: string;
    now: string;
  }): Promise<StoredPayChanguCardCharge> {
    assert.equal(this.order.status, "pending_payment");
    assert.equal(this.order.paymentReference, null);
    this.order.paymentReference = input.paymentReference;
    const charge: StoredPayChanguCardCharge = {
      id: input.id,
      orderId: input.order.id,
      buyerId: input.order.buyerId,
      paymentReference: input.paymentReference,
      chargeId: input.chargeId,
      amount: input.order.amount,
      currency: input.order.currency,
      status: "pending",
      requires3dsAuth: false,
      threeDsAuthUrl: null,
      resultUrl: input.resultUrl,
      providerOrderReference: null,
      lastProviderStatus: null,
      failureReason: null,
      verifiedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.charges.set(charge.chargeId, charge);
    this.payments.set(charge.paymentReference, {
      id: "payment_" + charge.id,
      reference: charge.paymentReference,
      orderId: charge.orderId,
      status: "pending",
      verified: false,
    });
    return { ...charge };
  }

  async getPaymentSummary(reference: string): Promise<DirectCardPaymentSummary | null> {
    const payment = this.payments.get(reference);
    return payment ? { ...payment } : null;
  }

  async getChargeById(chargeId: string): Promise<StoredPayChanguCardCharge | null> {
    const charge = this.charges.get(chargeId);
    return charge ? { ...charge } : null;
  }

  async getChargeByPaymentReference(reference: string): Promise<StoredPayChanguCardCharge | null> {
    const charge = [...this.charges.values()].find((item) => item.paymentReference === reference);
    return charge ? { ...charge } : null;
  }

  async updateCharge(chargeId: string, patch: DirectCardChargePatch): Promise<StoredPayChanguCardCharge | null> {
    const current = this.charges.get(chargeId);
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.charges.set(chargeId, updated);
    return { ...updated };
  }

  async recordVerification(
    charge: StoredPayChanguCardCharge,
    result: { chargeId: string; verified: boolean; status: string; failureReason?: string },
  ): Promise<DirectCardPaymentSummary> {
    const current = this.payments.get(charge.paymentReference);
    assert.ok(current);
    const updated: DirectCardPaymentSummary = {
      ...current,
      status: result.status === "failed" || result.status === "reversed" ? "failed" : "pending_verification",
      verified: false,
    };
    this.payments.set(charge.paymentReference, updated);
    return { ...updated };
  }

  async settleVerifiedCharge(
    charge: StoredPayChanguCardCharge,
    result: { chargeId: string; verified: boolean; status: string },
  ): Promise<DirectCardPaymentSummary> {
    assert.equal(result.verified, true);
    const current = this.payments.get(charge.paymentReference);
    assert.ok(current);
    if (current.verified) return { ...current };
    const paidCharge = { ...charge, status: "paid" as const, failureReason: null, verifiedAt: new Date().toISOString() };
    this.charges.set(charge.chargeId, paidCharge);
    const paidPayment: DirectCardPaymentSummary = { ...current, status: "captured", verified: true };
    this.payments.set(charge.paymentReference, paidPayment);
    this.order.status = "in_escrow";
    this.settlementCount += 1;
    return { ...paidPayment };
  }
}

const validInput = {
  orderId: "order_card_test_1",
  buyerId: "buyer_1",
  email: "buyer@example.com",
  card: {
    cardNumber: "4242 4242 4242 4242",
    expiry: "12/30",
    cvv: "123",
    cardholderName: "Test Buyer",
  },
};

function createAuthorizationAdapter(calls: Array<Record<string, unknown>>): DirectCardAuthorizationAdapter {
  return {
    async completeAuthorization(input) {
      calls.push({ ...input });
      return { completed: true };
    },
  };
}

test("direct-card service creates the pending records before initiation and settles after verified return", async () => {
  const savedEnv = saveEnv();
  const originalFetch = global.fetch;
  const store = new FakeDirectCardStore();
  const authorizationCalls: Array<Record<string, unknown>> = [];
  let submittedChargeId = "";
  const service = createPayChanguDirectCardService({
    store,
    authorizationAdapter: createAuthorizationAdapter(authorizationCalls),
  });

  setTestEnv();
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-secret");

    if (target === "https://api.paychangu.com/charge-card/payments") {
      const pendingBeforeProviderCall = [...store.charges.values()][0];
      assert.ok(pendingBeforeProviderCall, "charge record must be stored before provider call");
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      submittedChargeId = String(payload.charge_id ?? "");
      assert.equal(submittedChargeId, pendingBeforeProviderCall.chargeId);
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
      const chargeId = decodeURIComponent(target.split("/").pop() ?? "");
      return jsonResponse({
        status: "success",
        data: { charge_id: chargeId, status: "success", amount: 1000, currency: "MWK" },
      });
    }

    return jsonResponse({ status: "failed" }, 404);
  }) as typeof fetch;

  try {
    const initiated = await service.createCheckout(validInput);
    assert.equal(initiated.requiresAction, true);
    assert.equal(initiated.paymentVerified, false);
    assert.equal(initiated.charge.status, "requires_action");
    assert.equal(initiated.payment.status, "requires_action");
    assert.equal(initiated.charge.chargeId, submittedChargeId);
    assert.equal(initiated.charge.providerOrderReference, "provider-order-ref-1");

    const storedSerialized = JSON.stringify({
      charge: await store.getChargeById(submittedChargeId),
      payment: await store.getPaymentSummary(initiated.payment.reference),
    });
    assert.equal(storedSerialized.includes("4242424242424242"), false);
    assert.equal(storedSerialized.includes('"cvv":"123"'), false);
    assert.equal(storedSerialized.includes("Test Buyer"), false);

    const returnResult = await service.handleReturn({ chargeId: submittedChargeId, callbackStatusHint: "success" });
    assert.equal(returnResult.verified, true);
    assert.equal(returnResult.status, "paid");
    assert.equal(returnResult.payment.status, "captured");
    assert.equal(returnResult.payment.verified, true);
    assert.equal(authorizationCalls.length, 1);
    assert.equal(authorizationCalls[0].callbackStatusHint, "success");
    assert.equal(store.settlementCount, 1);
    assert.equal(store.order.status, "in_escrow");

    const replay = await service.reconcile(submittedChargeId);
    assert.equal(replay.verified, true);
    assert.equal(store.settlementCount, 1, "reconciliation must not settle twice");
  } finally {
    global.fetch = originalFetch;
    restoreEnv(savedEnv);
  }
});

test("direct-card service rejects an unresolved validation contract before persistence or provider access", async () => {
  const savedEnv = saveEnv();
  const originalFetch = global.fetch;
  const store = new FakeDirectCardStore();
  const service = createPayChanguDirectCardService({ store });
  setTestEnv();
  delete process.env.PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED;
  global.fetch = (async () => {
    throw new Error("Provider must not be called while the validation contract is unresolved.");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => service.createCheckout(validInput),
      /validation\/authorization contract is confirmed/,
    );
    assert.equal(store.charges.size, 0);
    assert.equal(store.payments.size, 0);
    assert.equal(store.order.paymentReference, null);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(savedEnv);
  }
});

test("direct-card service rejects an order owned by another buyer before persistence", async () => {
  const savedEnv = saveEnv();
  const store = new FakeDirectCardStore();
  const service = createPayChanguDirectCardService({
    store,
    authorizationAdapter: createAuthorizationAdapter([]),
  });
  setTestEnv();

  try {
    await assert.rejects(
      () => service.createCheckout({ ...validInput, buyerId: "another_buyer" }),
      /not owned by the authenticated buyer/,
    );
    assert.equal(store.charges.size, 0);
    assert.equal(store.payments.size, 0);
  } finally {
    restoreEnv(savedEnv);
  }
});
