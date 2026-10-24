import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPayChanguDirectCardChargeId,
  initiatePayChanguDirectCardCharge,
  verifyPayChanguDirectCardCharge,
  type PayChanguDirectCardConfig,
  type PayChanguDirectCardInput,
} from '../paychangu.card.js';

const approvedTestConfig: PayChanguDirectCardConfig = {
  enabled: true,
  pciDssApproved: true,
  paychanguSecretKey: 'test-secret',
  paychanguBaseUrl: 'https://api.paychangu.com',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validCardInput(overrides: Partial<PayChanguDirectCardInput> = {}): PayChanguDirectCardInput {
  return {
    amount: 1200,
    currency: 'MWK',
    email: 'buyer@example.com',
    redirectUrl: 'https://buymesho.app/api/payments/card/return',
    chargeId: 'BM-CARD-test_charge_123',
    cardNumber: '4242 4242 4242 4242',
    expiry: '12/30',
    cvv: '123',
    cardholderName: 'Test Buyer',
    ...overrides,
  };
}

test('direct card initiation sends the documented payload and never returns card data', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await initiatePayChanguDirectCardCharge(validCardInput(), {
    ...approvedTestConfig,
    fetcher: (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({ success: true, requires_3ds_auth: false });
    }) as typeof fetch,
  });

  assert.equal(requestUrl, 'https://api.paychangu.com/charge-card/payments');
  assert.equal(requestInit?.method, 'POST');
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-secret');
  const payload = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(payload.amount, '1200.00');
  assert.equal(payload.currency, 'MWK');
  assert.equal(payload.charge_id, 'BM-CARD-test_charge_123');
  assert.equal(payload.card_number, '4242424242424242');
  assert.equal(payload.cvv, '123');
  assert.equal(result.status, 'pending_verification');
  assert.equal(result.chargeId, 'BM-CARD-test_charge_123');
  assert.equal(JSON.stringify(result).includes('4242424242424242'), false);
  assert.equal(JSON.stringify(result).includes('"cvv"'), false);
});

test('direct card initiation exposes a validated 3-D Secure URL but remains unverified', async () => {
  const result = await initiatePayChanguDirectCardCharge(validCardInput(), {
    ...approvedTestConfig,
    fetcher: (async () => jsonResponse({
      success: true,
      requires_3ds_auth: true,
      orderReference: 'order-reference-123',
      '3ds_auth_link': 'https://in.paychangu.com/3ds/auth?reference=test',
    })) as typeof fetch,
  });

  assert.equal(result.status, 'requires_action');
  assert.equal(result.requires3dsAuth, true);
  assert.equal(result.threeDsAuthUrl, 'https://in.paychangu.com/3ds/auth?reference=test');
});

test('direct card is disabled unless both feature and PCI/account flags are explicitly set', async () => {
  await assert.rejects(
    () => initiatePayChanguDirectCardCharge(validCardInput(), {
      ...approvedTestConfig,
      enabled: false,
      fetcher: (async () => { throw new Error('fetch must not run'); }) as typeof fetch,
    }),
    /Direct Card Charge is disabled/,
  );

  await assert.rejects(
    () => initiatePayChanguDirectCardCharge(validCardInput(), {
      ...approvedTestConfig,
      pciDssApproved: false,
      fetcher: (async () => { throw new Error('fetch must not run'); }) as typeof fetch,
    }),
    /requires PCI DSS approval/,
  );
});

test('direct card validation rejects malformed data before making a provider request', async () => {
  await assert.rejects(
    () => initiatePayChanguDirectCardCharge(validCardInput({ expiry: '13/30' }), {
      ...approvedTestConfig,
      fetcher: (async () => { throw new Error('fetch must not run'); }) as typeof fetch,
    }),
    /expiry must use MM\/YY/,
  );

  await assert.rejects(
    () => initiatePayChanguDirectCardCharge(validCardInput({ amount: -1 }), approvedTestConfig),
    /amount must be positive/,
  );
});

test('charge verification requires success, matching charge ID, amount and currency', async () => {
  const result = await verifyPayChanguDirectCardCharge({
    chargeId: 'BM-CARD-test_charge_123',
    expectedAmount: 1200,
    expectedCurrency: 'MWK',
  }, {
    ...approvedTestConfig,
    fetcher: (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), 'https://api.paychangu.com/charge-card/verify/BM-CARD-test_charge_123');
      assert.equal(init?.method, 'GET');
      return jsonResponse({
        status: 'success',
        data: { charge_id: 'BM-CARD-test_charge_123', status: 'success', amount: 1200, currency: 'MWK' },
      });
    }) as typeof fetch,
  });

  assert.equal(result.verified, true);
  assert.equal(result.status, 'paid');
  assert.equal(result.amount, 1200);
  assert.equal(result.currency, 'MWK');
});

test('charge verification fails closed on amount, currency, identity and status mismatches', async () => {
  const scenarios = [
    { id: 'BM-CARD-test_charge_123', amount: 1199, currency: 'MWK', status: 'success' },
    { id: 'another-charge', amount: 1200, currency: 'MWK', status: 'success' },
    { id: 'BM-CARD-test_charge_123', amount: 1200, currency: 'USD', status: 'success' },
    { id: 'BM-CARD-test_charge_123', amount: 1200, currency: 'MWK', status: 'declined' },
  ];

  for (const scenario of scenarios) {
    const result = await verifyPayChanguDirectCardCharge({
      chargeId: 'BM-CARD-test_charge_123',
      expectedAmount: 1200,
      expectedCurrency: 'MWK',
    }, {
      ...approvedTestConfig,
      fetcher: (async () => jsonResponse({
        status: 'success',
        data: {
          charge_id: scenario.id,
          status: scenario.status,
          amount: scenario.amount,
          currency: scenario.currency,
        },
      })) as typeof fetch,
    });

    assert.equal(result.verified, false);
  }
});

test('charge IDs are unique and do not depend on card information', () => {
  const first = createPayChanguDirectCardChargeId();
  const second = createPayChanguDirectCardChargeId();
  assert.match(first, /^BM-CARD-[0-9a-f]{32}$/);
  assert.notEqual(first, second);
});
