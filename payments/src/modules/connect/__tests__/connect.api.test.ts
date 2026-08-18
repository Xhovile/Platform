import test from 'node:test';
import assert from 'node:assert/strict';

type ConnectApiModule = typeof import('../api.ts');

function installSessionStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem(key: string) {
          return store.has(key) ? store.get(key)! : null;
        },
        setItem(key: string, value: string) {
          store.set(key, String(value));
        },
        removeItem(key: string) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
      },
    },
  });
}

async function importFreshConnectApi(tag: string): Promise<ConnectApiModule> {
  return import(new URL(`../api.ts?${tag}`, import.meta.url).href) as Promise<ConnectApiModule>;
}

test('validateConnectStartPayload rejects malformed frontend env values', async () => {
  const api = await importFreshConnectApi('validation');

  assert.throws(
    () =>
      api.validateConnectStartPayload({
        clientId: '',
        redirectUri: 'https://example.com/callback',
        mode: 'test',
        whUrl: 'https://example.com/webhook',
        whSecret: 'secret',
      }),
    /VITE_PAYCHANGU_CLIENT_ID is not configured/,
  );

  assert.throws(
    () =>
      api.validateConnectStartPayload({
        clientId: 'client_123',
        redirectUri: '',
        mode: 'test',
        whUrl: 'https://example.com/webhook',
        whSecret: 'secret',
      }),
    /redirectUri is not configured|redirectUri must be a valid URL/,
  );

  assert.throws(
    () =>
      api.validateConnectStartPayload({
        clientId: 'client_123',
        redirectUri: 'https://example.com/callback',
        mode: 'demo' as never,
        whUrl: 'https://example.com/webhook',
        whSecret: 'secret',
      }),
    /mode must be "live" or "test"/,
  );

  assert.throws(
    () =>
      api.validateConnectStartPayload({
        clientId: 'client_123',
        redirectUri: 'https://example.com/callback',
        mode: 'test',
        whSecret: 'secret',
      }),
    /VITE_PAYCHANGU_WEBHOOK_URL is not configured/,
  );

  assert.throws(
    () =>
      api.validateConnectStartPayload({
        clientId: 'client_123',
        redirectUri: 'https://example.com/callback',
        mode: 'test',
        whUrl: 'https://example.com/webhook',
      }),
    /VITE_PAYCHANGU_WEBHOOK_SECRET is not configured/,
  );
});

test('createConnectAuthorizationLink strips sellerUid and stores connect context', async () => {
  installSessionStorage();
  const api = await importFreshConnectApi('create-link');

  const originalFetch = global.fetch;
  let requestBody: Record<string, unknown> | null = null;
  global.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({
      connectAttemptId: 'attempt_123',
      authorizationUrl: 'https://paychangu.test/connect/authorize-link',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await api.createConnectAuthorizationLink({
      sellerUid: 'seller_1',
      clientId: 'client_123',
      redirectUri: 'https://example.com/callback',
      mode: 'test',
      whUrl: 'https://example.com/webhook',
      whSecret: 'secret',
    });

    assert.equal(result.connectAttemptId, 'attempt_123');
    assert.equal(result.authorizationUrl, 'https://paychangu.test/connect/authorize-link');
    assert.ok(requestBody, 'request body should be captured');
    assert.equal(Object.hasOwn(requestBody as object, 'sellerUid'), false);
    assert.equal((requestBody as Record<string, unknown>).clientId, 'client_123');

    const stored = api.getStoredConnectContext();
    assert.ok(stored, 'connect context should be stored');
    assert.equal(stored?.sellerUid, 'seller_1');
    assert.equal(stored?.connectAttemptId, 'attempt_123');
    assert.ok(stored?.startedAt, 'startedAt should be present');
  } finally {
    global.fetch = originalFetch;
  }
});

test('getStoredConnectContext and clearStoredConnectContext round-trip session storage', async () => {
  installSessionStorage();
  const api = await importFreshConnectApi('storage');

  window.sessionStorage.setItem(
    'buymesho.paychangu.connectContext',
    JSON.stringify({
      sellerUid: 'seller_1',
      connectAttemptId: 'attempt_123',
      startedAt: '2026-07-05T00:00:00.000Z',
    }),
  );

  const stored = api.getStoredConnectContext();
  assert.deepEqual(stored, {
    sellerUid: 'seller_1',
    connectAttemptId: 'attempt_123',
    startedAt: '2026-07-05T00:00:00.000Z',
  });

  api.clearStoredConnectContext();
  assert.equal(api.getStoredConnectContext(), null);
});
