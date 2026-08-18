import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createPayoutRouter } from '../../escrowRoutes.js';

type TestUser = {
  uid: string;
  isAdmin?: boolean;
};

type JsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

const originalFetch = global.fetch;
const originalBaseUrl = process.env.PAYCHANGU_PAYOUT_BASE_URL;
const originalSecret = process.env.PAYCHANGU_SECRET_KEY;

function createPayoutApp(user: TestUser): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/payouts', createPayoutRouter((req, res, next) => {
    if (!req.header('authorization')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = {
      uid: user.uid,
      email: `${user.uid}@example.com`,
      is_admin: user.isAdmin === true,
    };
    return next();
  }));
  return app;
}

async function callProviderRoute(app: express.Express, path: string, withAuth = true): Promise<JsonResponse> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await originalFetch(`http://127.0.0.1:${port}${path}`, {
      headers: withAuth ? { authorization: 'Bearer test' } : undefined,
    });
    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    server.close();
  }
}

function mockPayChanguProvider(payload: unknown, status = 200): void {
  process.env.PAYCHANGU_PAYOUT_BASE_URL = 'https://paychangu.test';
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';
  global.fetch = (async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

function restoreProviderEnvironment(): void {
  global.fetch = originalFetch;
  if (originalBaseUrl === undefined) {
    delete process.env.PAYCHANGU_PAYOUT_BASE_URL;
  } else {
    process.env.PAYCHANGU_PAYOUT_BASE_URL = originalBaseUrl;
  }
  if (originalSecret === undefined) {
    delete process.env.PAYCHANGU_SECRET_KEY;
  } else {
    process.env.PAYCHANGU_SECRET_KEY = originalSecret;
  }
}

test('authenticated seller can list normalized mobile money operators', async () => {
  mockPayChanguProvider({
    data: [
      { ref_id: 'tnm', name: 'TNM Mpamba', authorization: 'Bearer should-not-leak' },
      { refId: 'airtel', operator_name: 'Airtel Money', headers: { authorization: 'secret' } },
    ],
  });

  try {
    const result = await callProviderRoute(
      createPayoutApp({ uid: 'seller-provider-routes' }),
      '/api/payouts/provider/mobile-money-operators',
    );

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      operators: [
        { refId: 'tnm', name: 'TNM Mpamba' },
        { refId: 'airtel', name: 'Airtel Money' },
      ],
    });
    assert.doesNotMatch(JSON.stringify(result.body), /authorization|headers|should-not-leak|secret/i);
  } finally {
    restoreProviderEnvironment();
  }
});

test('admin can list normalized payout banks for a seller', async () => {
  let requestedUrl = '';
  process.env.PAYCHANGU_PAYOUT_BASE_URL = 'https://paychangu.test';
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';
  global.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      data: {
        banks: [
          { uuid: 'bank-uuid-1', bank_name: 'National Bank', internal_config: { token: 'hidden' } },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await callProviderRoute(
      createPayoutApp({ uid: 'admin-provider-routes', isAdmin: true }),
      '/api/payouts/provider/banks?currency=MWK&sellerUid=seller-provider-routes',
    );

    assert.equal(result.status, 200);
    assert.match(requestedUrl, /currency=MWK/);
    assert.deepEqual(result.body, {
      banks: [{ uuid: 'bank-uuid-1', name: 'National Bank' }],
      currency: 'MWK',
    });
    assert.doesNotMatch(JSON.stringify(result.body), /internal_config|token|hidden/i);
  } finally {
    restoreProviderEnvironment();
  }
});

test('provider lookup routes reject unauthenticated requests', async () => {
  mockPayChanguProvider({ data: [] });

  try {
    const result = await callProviderRoute(
      createPayoutApp({ uid: 'seller-provider-routes' }),
      '/api/payouts/provider/banks?currency=MWK',
      false,
    );

    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'Unauthorized');
  } finally {
    restoreProviderEnvironment();
  }
});

test('provider lookup failure returns a gateway error without raw provider config', async () => {
  mockPayChanguProvider({ message: 'Provider unavailable', secret: 'should-not-leak' }, 503);

  try {
    const result = await callProviderRoute(
      createPayoutApp({ uid: 'seller-provider-routes' }),
      '/api/payouts/provider/mobile-money-operators',
    );

    assert.equal(result.status, 502);
    assert.equal(result.body.error, 'Provider unavailable');
    assert.doesNotMatch(JSON.stringify(result.body), /secret|should-not-leak|authorization|headers/i);
  } finally {
    restoreProviderEnvironment();
  }
});
