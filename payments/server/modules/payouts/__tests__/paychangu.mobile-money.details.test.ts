import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPayChanguMobileMoneyPayoutDetails } from '../paychangu.mobile-money.details.js';

const originalFetch = global.fetch;

test('PayChangu mobile money payout details uses the documented path', async () => {
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';

  const requests: Array<{ url: string; method: string }> = [];
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
    });

    return new Response(JSON.stringify({ status: 'success', data: { charge_id: 'PC-64FU65435', ref_id: '95652259752', trans_id: 'tx-1', amount: 1000, currency: 'MWK', status: 'pending', mobile: '+265990xxxx00' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await getPayChanguMobileMoneyPayoutDetails('PC-64FU65435');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'https://api.paychangu.com/mobile-money/payments/PC-64FU65435/details');
    assert.equal(requests[0]?.method, 'GET');
    assert.equal(result.chargeId, 'PC-64FU65435');
    assert.equal(result.status, 'pending');
    assert.equal(result.amount, 1000);
  } finally {
    global.fetch = originalFetch;
    delete process.env.PAYCHANGU_SECRET_KEY;
  }
});