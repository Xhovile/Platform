import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createPaymentAdminPayoutDisplayRouter } from '../payment.admin.payout.display.routes.js';
import { getPaymentDb } from '../../../postgresCompat.js';

function createAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createPaymentAdminPayoutDisplayRouter((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      uid: 'admin-user',
      email: 'admin@example.com',
      is_admin: true,
    };
    next();
  }));
  return app;
}

async function callAdmin(path: string): Promise<{ status: number; body: unknown }> {
  const app = createAdminApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: {
        authorization: 'Bearer test',
      },
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    server.close();
  }
}

function seedPayoutWithStaleDestination(prefix: string) {
  const db = getPaymentDb();
  const now = new Date().toISOString();
  const sellerId = `${prefix}-seller`;
  const verifiedDestinationId = `${prefix}-destination`;
  const staleDestinationId = `${prefix}-stale-destination`;
  const payoutId = `${prefix}-payout`;
  const orderId = `${prefix}-order`;

  db.prepare(`DELETE FROM payout_attempts WHERE payout_id = ?`).run(payoutId);
  db.prepare(`DELETE FROM payouts WHERE id = ?`).run(payoutId);
  db.prepare(`DELETE FROM escrows WHERE order_id = ?`).run(orderId);
  db.prepare(`DELETE FROM orders WHERE id = ?`).run(orderId);
  db.prepare(`DELETE FROM seller_payout_accounts WHERE id = ?`).run(verifiedDestinationId);
  db.prepare(`DELETE FROM sellers WHERE uid = ?`).run(sellerId);

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended) VALUES (?, ?, 1, 0)`).run(
    sellerId,
    `${prefix}@example.com`,
  );

  db.prepare(`INSERT INTO seller_payout_accounts (
    id, seller_uid, destination_type, provider_name, provider_ref_id,
    currency, account_name, mobile_encrypted, masked_account, destination_fingerprint,
    is_default, verification_status, verification_attempts, is_active, created_at, updated_at
  ) VALUES (?, ?, 'mobile_money', 'Airtel Money', 'airtel-money',
    'MWK', 'Fallback Verified Seller', '265999111333', '****1333', ?,
    1, 'verified', 1, 1, ?, ?)`).run(
    verifiedDestinationId,
    sellerId,
    `${prefix}-fingerprint`,
    now,
    now,
  );

  db.prepare(`INSERT INTO orders (
    id, buyer_id, seller_id, source, status, currency,
    subtotal_amount, subtotal_currency, total_amount, total_currency, items, created_at, updated_at
  ) VALUES (?, ?, ?, 'listing', 'fulfilled', 'MWK', 1500, 'MWK', 1500, 'MWK', '[]', ?, ?)`).run(
    orderId,
    `${prefix}-buyer`,
    sellerId,
    now,
    now,
  );

  db.prepare(`INSERT INTO escrows (
    id, order_id, state, currency, balance_amount, balance_currency, entries, created_at, updated_at
  ) VALUES (?, ?, 'released', 'MWK', 0, 'MWK', '[]', ?, ?)`).run(
    `${prefix}-escrow`,
    orderId,
    now,
    now,
  );

  db.prepare(`INSERT INTO payouts (
    id, seller_id, order_id, escrow_id, release_entry_id, destination_account_id,
    amount, currency, status, provider, provider_charge_id, requested_by, requested_at,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 1470, 'MWK', 'held', 'paychangu', ?, 'admin-seed', ?, ?, ?)`).run(
    payoutId,
    sellerId,
    orderId,
    `${prefix}-escrow`,
    `${prefix}-release`,
    staleDestinationId,
    `BM-PO-${payoutId}-A01`,
    now,
    now,
    now,
  );

  db.prepare(`INSERT INTO payout_attempts (
    id, payout_id, attempt_no, provider, provider_charge_id, request_payload,
    response_payload, status, sent_at, completed_at, created_at, updated_at
  ) VALUES (?, ?, 1, 'paychangu', ?, '{}', '{}', 'failed', ?, ?, ?, ?)`).run(
    `${prefix}-attempt`,
    payoutId,
    `BM-PO-${payoutId}-A01`,
    now,
    now,
    now,
    now,
  );

  return { sellerId, verifiedDestinationId, payoutId };
}

test('admin payouts list hydrates a fallback verified destination when the payout FK is stale', async () => {
  const { verifiedDestinationId, payoutId } = seedPayoutWithStaleDestination('admin-display-fallback');

  const result = await callAdmin('/api/admin/payouts?limit=50&offset=0');

  assert.equal(result.status, 200);
  const body = result.body as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rows = Array.isArray(body) ? body : body.rows ?? [];
  assert.ok(Array.isArray(rows));
  const row = rows.find((entry) => entry.id === payoutId);
  assert.ok(row);
  assert.equal(row?.destinationAccountId, verifiedDestinationId);
  assert.equal(row?.destinationRecoveredFromFallback, true);
  assert.equal(row?.destinationVerificationStatus, 'verified');
  assert.equal(row?.destinationActive, true);
  assert.equal(row?.destinationMaskedAccount, '****1333');
});
test('admin payouts diagnostics prefer provider failure over destination fallback wording', async () => {
  const { payoutId } = seedPayoutWithStaleDestination('admin-display-provider-failure');
  const db = getPaymentDb();
  db.prepare(`UPDATE payouts SET status = 'failed', failure_reason = 'insufficient_provider_balance' WHERE id = ?`).run(payoutId);
  db.prepare(`UPDATE payout_attempts SET status = 'failed', failure_reason = 'insufficient provider balance', response_payload = ? WHERE payout_id = ?`).run(
    JSON.stringify({ message: 'insufficient provider balance' }),
    payoutId,
  );

  const result = await callAdmin('/api/admin/payouts?limit=50&offset=0');
  assert.equal(result.status, 200);
  const body = result.body as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rows = Array.isArray(body) ? body : body.rows ?? [];
  const row = rows.find((entry) => entry.id === payoutId);
  assert.ok(row);
  assert.equal(row.destinationVerificationStatus, 'verified');
  assert.notEqual(row.retryBlockedReason, 'Destination pending verification');
  assert.deepEqual((row.diagnostics as Record<string, unknown>).latestAttemptProviderResponse, { message: 'insufficient provider balance' });
  assert.equal((row.diagnostics as Record<string, unknown>).latestAttemptFailureReason, 'insufficient provider balance');
});

test('admin payouts diagnostics expose verified destination with missing provider attempt', async () => {
  const { payoutId } = seedPayoutWithStaleDestination('admin-display-missing-attempt');
  const db = getPaymentDb();
  db.prepare(`DELETE FROM payout_attempts WHERE payout_id = ?`).run(payoutId);
  db.prepare(`UPDATE payouts SET status = 'processing', failure_reason = NULL WHERE id = ?`).run(payoutId);

  const result = await callAdmin('/api/admin/payouts?limit=50&offset=0');
  assert.equal(result.status, 200);
  const body = result.body as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rows = Array.isArray(body) ? body : body.rows ?? [];
  const row = rows.find((entry) => entry.id === payoutId);
  assert.ok(row);
  assert.equal(row.destinationVerificationStatus, 'verified');
  assert.equal((row.diagnostics as Record<string, unknown>).latestAttemptNo, null);
  assert.notEqual(row.retryBlockedReason, 'Destination pending verification');
});

test('admin payout display recovers seller and provider labels from order and destination when payout row is incomplete', async () => {
  const { sellerId, verifiedDestinationId, payoutId } = seedPayoutWithStaleDestination('admin-display-incomplete-card');
  const db = getPaymentDb();
  db.prepare(`UPDATE sellers SET business_name = ? WHERE uid = ?`).run('Recovered Seller', sellerId);
  db.prepare(`UPDATE payouts SET seller_id = '', provider = '', destination_account_id = NULL WHERE id = ?`).run(payoutId);

  const result = await callAdmin('/api/admin/payouts?limit=50&offset=0');

  assert.equal(result.status, 200);
  const body = result.body as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rows = Array.isArray(body) ? body : body.rows ?? [];
  const row = rows.find((entry) => entry.id === payoutId);
  assert.ok(row);
  assert.equal(row.sellerId, sellerId);
  assert.equal(row.sellerBusinessName, 'Recovered Seller');
  assert.equal(row.provider, 'paychangu');
  assert.equal(row.destinationAccountId, verifiedDestinationId);
  assert.equal(row.destinationVerificationStatus, 'verified');
  assert.equal(row.destinationRecoveredFromFallback, true);
});

test('admin payout detail recovers destination when payout destination FK is missing', async () => {
  const { sellerId, verifiedDestinationId, payoutId } = seedPayoutWithStaleDestination('admin-display-detail-missing-fk');
  const db = getPaymentDb();
  db.prepare(`UPDATE payouts SET destination_account_id = NULL WHERE id = ?`).run(payoutId);

  const result = await callAdmin(`/api/admin/payouts/detail/${encodeURIComponent(payoutId)}`);

  assert.equal(result.status, 200);
  const row = result.body as Record<string, unknown>;
  assert.equal(row.sellerId, sellerId);
  assert.equal(row.destinationAccountId, verifiedDestinationId);
  assert.equal(row.destinationVerificationStatus, 'verified');
  assert.equal(row.destinationRecoveredFromFallback, true);
});
