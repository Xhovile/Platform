import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentDb } from '../../../postgresCompat.js';

const BASE_ENV = {
  PAYCHANGU_SECRET_KEY: 'test-paychangu-secret',
  PAYCHANGU_WEBHOOK_SECRET: 'test-webhook-secret',
  CONNECT_TOKEN_ENCRYPTION_KEY: 'test-connect-encryption-key',
  PAYCHANGU_BASE_URL: 'https://api.paychangu.test',
  PAYCHANGU_REVOKE_ACCESS_TOKEN_PATH: '/new-endpoint-2',
};

function setConnectEnv(overrides: Partial<typeof BASE_ENV> = {}): void {
  Object.assign(process.env, BASE_ENV, overrides);
}

function ensureConnectTables(): void {
  const db = getPaymentDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sellers (
      uid TEXT PRIMARY KEY,
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS connect_attempts (
      id TEXT PRIMARY KEY,
      seller_uid TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seller_connect_accounts (
      id TEXT PRIMARY KEY,
      seller_uid TEXT NOT NULL UNIQUE,
      provider_name TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      scope TEXT,
      authorization_url TEXT,
      connect_user_id TEXT,
      connect_user_email TEXT,
      connect_user_name TEXT,
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      webhook_url TEXT,
      webhook_secret_encrypted TEXT,
      connected_at TEXT,
      revoked_at TEXT,
      last_error TEXT,
      raw_profile TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function clearConnectTables(): void {
  ensureConnectTables();
  const db = getPaymentDb();
  db.prepare('DELETE FROM seller_connect_accounts').run();
  db.prepare('DELETE FROM connect_attempts').run();
  db.prepare('DELETE FROM sellers').run();
}

async function importFreshService(tag: string) {
  return import(new URL(`../connect.service.ts?${tag}`, import.meta.url).href);
}

test('validateConnectEnvironment throws when each required env value is missing', async () => {
  setConnectEnv();
  const service = await importFreshService('missing-env');

  delete process.env.PAYCHANGU_SECRET_KEY;
  assert.throws(() => service.validateConnectEnvironment(), /PAYCHANGU_SECRET_KEY/);

  setConnectEnv();
  delete process.env.PAYCHANGU_WEBHOOK_SECRET;
  assert.throws(() => service.validateConnectEnvironment(), /PAYCHANGU_WEBHOOK_SECRET/);

  setConnectEnv();
  delete process.env.CONNECT_TOKEN_ENCRYPTION_KEY;
  assert.throws(() => service.validateConnectEnvironment(), /CONNECT_TOKEN_ENCRYPTION_KEY/);

  setConnectEnv();
});

test('startConnectOnboarding creates a pending attempt and authorization URL', async () => {
  setConnectEnv();
  const service = await importFreshService('start-onboarding');
  clearConnectTables();

  const db = getPaymentDb();
  db.prepare("INSERT INTO sellers (uid, email) VALUES (?, ?)").run('seller_1', 'seller@example.com');

  const result = service.startConnectOnboarding({
    sellerUid: 'seller_1',
    clientId: 'client_123',
    redirectUri: 'https://example.com/connect/callback',
    mode: 'test',
    whUrl: 'https://example.com/webhook',
    whSecret: 'webhook-secret',
  });

  assert.ok(result.connectAttemptId, 'connectAttemptId should be present');
  assert.ok(result.authorizationUrl, 'authorizationUrl should be present');

  const attempt = db
    .prepare('SELECT id, seller_uid, status, expires_at, consumed_at, metadata FROM connect_attempts WHERE id = ?')
    .get(result.connectAttemptId) as
    | { id: string; seller_uid: string; status: string; expires_at: string; consumed_at: string | null; metadata: string | null }
    | undefined;

  assert.ok(attempt, 'connect attempt row should exist');
  assert.equal(attempt?.seller_uid, 'seller_1');
  assert.equal(attempt?.status, 'pending');
  assert.equal(attempt?.consumed_at, null);
  assert.ok(attempt?.expires_at, 'expires_at should be set');

  const metadata = attempt?.metadata ? JSON.parse(attempt.metadata) as Record<string, unknown> : null;
  assert.equal(metadata?.clientId, 'client_123');
  assert.equal(metadata?.redirectUri, 'https://example.com/connect/callback');
  assert.equal(metadata?.mode, 'test');
  assert.equal(metadata?.whUrl, 'https://example.com/webhook');
});

test('recordConnectCallback fetches the connected user and stores encrypted token', async () => {
  setConnectEnv();
  const service = await importFreshService('record-callback');
  clearConnectTables();

  const db = getPaymentDb();
  db.prepare("INSERT INTO sellers (uid, email) VALUES (?, ?)").run('seller_1', 'seller@example.com');

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    fetchCalled = true;
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.match(target, /\/connect\/user\?access_token=access-token-123$/);
    assert.equal(init?.method, 'GET');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer access-token-123');

    return new Response(JSON.stringify({
      id: 'user_123',
      email: 'seller@example.com',
      name: 'Seller One',
      phone: '+265999000111',
      status: 'active',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const account = await service.recordConnectCallback({
      sellerUid: 'seller_1',
      connectAttemptId: 'attempt_1',
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      mode: 'test',
      scope: 'payments',
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'webhook-secret',
      authorizationUrl: 'https://paychangu.test/connect/authorize-link',
      rawPayload: { source: 'callback-test' },
    });

    assert.equal(fetchCalled, true);
    assert.equal(account.sellerUid, 'seller_1');
    assert.equal(account.status, 'connected');
    assert.equal(account.connectUserId, 'user_123');
    assert.equal(account.connectUserEmail, 'seller@example.com');
    assert.equal(account.connectUserName, 'Seller One');
    assert.ok(account.accessTokenEncrypted, 'encrypted access token should be stored');

    const stored = service.getConnectAccount('seller_1');
    assert.ok(stored, 'stored connect account should exist');
    assert.equal(stored?.status, 'connected');
    assert.equal(service.decryptSecret(stored?.accessTokenEncrypted ?? null), 'access-token-123');
    assert.equal(service.decryptSecret(stored?.refreshTokenEncrypted ?? null), 'refresh-token-456');
    assert.equal(service.decryptSecret(stored?.webhookSecretEncrypted ?? null), 'webhook-secret');
  } finally {
    global.fetch = originalFetch;
  }
});

test('revokeConnectAccessToken revokes PayChangu access and clears local secrets', async () => {
  setConnectEnv();
  const service = await importFreshService('revoke-access-token');
  clearConnectTables();

  const db = getPaymentDb();
  db.prepare("INSERT INTO sellers (uid, email) VALUES (?, ?)").run('seller_1', 'seller@example.com');

  await service.recordConnectCallback({
    sellerUid: 'seller_1',
    connectAttemptId: 'attempt_1',
    accessToken: 'access-token-123',
    refreshToken: 'refresh-token-456',
    mode: 'test',
    scope: 'payments',
    webhookUrl: 'https://example.com/webhook',
    webhookSecret: 'webhook-secret',
    authorizationUrl: 'https://paychangu.test/connect/authorize-link',
    connectUser: {
      id: 'user_123',
      email: 'seller@example.com',
      name: 'Seller One',
      phone: '+265999000111',
      status: 'active',
    },
    rawPayload: { source: 'callback-test' },
  });

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    fetchCalled = true;
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    assert.match(target, /\/new-endpoint-2\?token=access-token-123$/);
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-paychangu-secret');
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Content-Type'), 'application/json');

    return new Response(JSON.stringify({ status: 'revoked' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const revoked = await service.revokeConnectAccessToken('seller_1', 'Manual revoke');

    assert.equal(fetchCalled, true);
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revokedAt ? true : false, true);
    assert.equal(revoked.lastError, 'Manual revoke');
    assert.equal(revoked.accessTokenEncrypted, null);
    assert.equal(revoked.refreshTokenEncrypted, null);
    assert.equal(revoked.webhookSecretEncrypted, null);
    assert.equal(revoked.authorizationUrl, null);
    assert.equal(revoked.connectUserId, null);
    assert.equal(revoked.connectUserEmail, null);
    assert.equal(revoked.connectUserName, null);
    assert.equal(revoked.rawProfile, null);

    const stored = service.getConnectAccount('seller_1');
    assert.ok(stored, 'stored connect account should exist after revoke');
    assert.equal(stored?.status, 'revoked');
    assert.equal(stored?.accessTokenEncrypted, null);
    assert.equal(stored?.refreshTokenEncrypted, null);
    assert.equal(stored?.webhookSecretEncrypted, null);
    assert.equal(stored?.authorizationUrl, null);
    assert.equal(stored?.connectUserId, null);
    assert.equal(stored?.connectUserEmail, null);
    assert.equal(stored?.connectUserName, null);
    assert.equal(service.decryptSecret(stored?.accessTokenEncrypted ?? null), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('recordConnectCallback rejects missing sellerUid with a clear error', async () => {
  setConnectEnv();
  const service = await importFreshService('record-callback-missing-seller');

  await assert.rejects(
    () => service.recordConnectCallback({ accessToken: 'access-token-123' } as never),
    /sellerUid is required/,
  );
});