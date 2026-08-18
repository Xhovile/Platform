import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createPaymentAdminRouter } from '../payment.admin.routes.js';
import { getPaymentDb } from '../../../postgresCompat.js';

function createAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createPaymentAdminRouter((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      uid: 'admin-user',
      email: 'admin@example.com',
      is_admin: true,
    };
    next();
  }));
  return app;
}

async function callAdmin(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = createAdminApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: {
        authorization: 'Bearer test',
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.json() as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    server.close();
  }
}

function resetAdminPayoutState(prefix: string) {
  const db = getPaymentDb();
  db.prepare(`DELETE FROM seller_payout_account_events WHERE seller_uid = ?`).run(`${prefix}-seller`);
  db.prepare(`DELETE FROM payout_events WHERE seller_id = ?`).run(`${prefix}-seller`);
  db.prepare(`DELETE FROM payout_attempts WHERE payout_id = ?`).run(`${prefix}-payout`);
  db.prepare(`DELETE FROM payouts WHERE id = ?`).run(`${prefix}-payout`);
  db.prepare(`DELETE FROM escrows WHERE order_id = ?`).run(`${prefix}-order`);
  db.prepare(`DELETE FROM orders WHERE id = ?`).run(`${prefix}-order`);
  db.prepare(`DELETE FROM seller_payout_accounts WHERE id = ?`).run(`${prefix}-destination`);
  db.prepare(`DELETE FROM admin_actions WHERE target_id = ?`).run(`${prefix}-seller`);
  db.prepare(`DELETE FROM sellers WHERE uid = ?`).run(`${prefix}-seller`);
}

function seedAdminPayout(prefix: string, payoutStatus = 'processing') {
  resetAdminPayoutState(prefix);
  const db = getPaymentDb();
  const now = new Date().toISOString();
  const sellerId = `${prefix}-seller`;
  const destinationId = `${prefix}-destination`;
  const payoutId = `${prefix}-payout`;
  const orderId = `${prefix}-order`;
  const attemptId = `${prefix}-attempt`;

  db.prepare(`INSERT INTO sellers (uid, email, is_verified, is_suspended) VALUES (?, ?, 1, 0)`).run(
    sellerId,
    `${prefix}@example.com`,
  );

  db.prepare(`INSERT INTO seller_payout_accounts (
    id, seller_uid, destination_type, provider_name, provider_ref_id,
    currency, account_name, mobile_encrypted, masked_account, destination_fingerprint,
    is_default, verification_status, verification_attempts, is_active, created_at, updated_at
  ) VALUES (?, ?, 'mobile_money', 'Airtel Money', 'airtel-money',
    'MWK', 'Admin Test Seller', '265999111333', '****1333', ?,
    1, 'pending', 0, 1, ?, ?)`).run(
    destinationId,
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
    last_attempt_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 1470, 'MWK', ?, 'paychangu', ?, 'admin-seed', ?, ?, ?, ?)`).run(
    payoutId,
    sellerId,
    orderId,
    `${prefix}-escrow`,
    `${prefix}-release`,
    destinationId,
    payoutStatus,
    `BM-PO-${payoutId}-A01`,
    now,
    attemptId,
    now,
    now,
  );

  db.prepare(`INSERT INTO payout_attempts (
    id, payout_id, attempt_no, provider, provider_charge_id, request_payload,
    response_payload, status, sent_at, completed_at, created_at, updated_at
  ) VALUES (?, ?, 1, 'paychangu', ?, '{}', '{}', ?, ?, ?, ?, ?)`).run(
    attemptId,
    payoutId,
    `BM-PO-${payoutId}-A01`,
    payoutStatus,
    now,
    now,
    now,
    now,
  );

  return { sellerId, destinationId, payoutId };
}

test('admin verification attempts record verified, failed, pending, and disabled outcomes', async () => {
  const cases = [
    { status: 'verified', reason: 'Matches seller identity', expectedActive: 1, expectedLastError: null, expectVerifiedAt: true },
    { status: 'failed', reason: 'KYC mismatch', expectedActive: 1, expectedLastError: 'KYC mismatch', expectVerifiedAt: false },
    { status: 'pending', reason: 'Awaiting document review', expectedActive: 1, expectedLastError: null, expectVerifiedAt: false },
    { status: 'disabled', reason: 'Seller requested removal', expectedActive: 0, expectedLastError: 'Seller requested removal', expectVerifiedAt: false },
  ] as const;

  for (const current of cases) {
    const { sellerId, destinationId } = seedAdminPayout(`admin-verify-${current.status}`, 'eligible');

    const result = await callAdmin(`/api/admin/payouts/destinations/${destinationId}/verification`, {
      method: 'POST',
      body: JSON.stringify({ status: current.status, reason: current.reason }),
    });

    assert.equal(result.status, 200);

    const db = getPaymentDb();
    const destination = db.prepare(
      `SELECT verification_status, last_error, verification_attempts, verified_at, is_active
       FROM seller_payout_accounts
       WHERE id = ?`,
    ).get(destinationId) as {
      verification_status: string;
      last_error: string | null;
      verification_attempts: number;
      verified_at: string | null;
      is_active: number;
    };
    assert.equal(destination.verification_status, current.status);
    assert.equal(destination.last_error, current.expectedLastError);
    assert.equal(destination.verification_attempts, 1);
    assert.equal(destination.is_active, current.expectedActive);
    if (current.expectVerifiedAt) {
      assert.match(destination.verified_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    } else {
      assert.equal(destination.verified_at, null);
    }

    const audit = db.prepare(
      `SELECT event_type, actor_id, note, payload
       FROM seller_payout_account_events
       WHERE seller_uid = ?
       ORDER BY id DESC
       LIMIT 1`,
    ).get(sellerId) as { event_type: string; actor_id: string | null; note: string | null; payload: string };
    assert.equal(audit.event_type, `destination_${current.status}`);
    assert.equal(audit.actor_id, 'admin-user');
    assert.equal(audit.note, current.reason);
    assert.deepEqual(JSON.parse(audit.payload), {
      previousStatus: 'pending',
      nextStatus: current.status,
      attempt: 1,
      active: current.expectedActive === 1,
    });
  }
});

test('admin payout suspension holds seller payouts and records control note', async () => {
  const { sellerId, payoutId } = seedAdminPayout('admin-suspend', 'failed');

  const result = await callAdmin(`/api/admin/payouts/sellers/${sellerId}/suspension`, {
    method: 'POST',
    body: JSON.stringify({ suspended: true, reason: 'Manual fraud review' }),
  });

  assert.equal(result.status, 200);

  const db = getPaymentDb();
  const seller = db.prepare(`SELECT is_suspended FROM sellers WHERE uid = ?`).get(sellerId) as { is_suspended: number };
  assert.equal(seller.is_suspended, 1);

  const payout = db.prepare(
    `SELECT status, failure_reason, manual_review_reason
     FROM payouts
     WHERE id = ?`,
  ).get(payoutId) as { status: string; failure_reason: string | null; manual_review_reason: string | null };
  assert.equal(payout.status, 'held');
  assert.equal(payout.failure_reason, 'seller_suspended');
  assert.equal(payout.manual_review_reason, 'Manual fraud review');

  const action = db.prepare(
    `SELECT action_type, details
     FROM admin_actions
     WHERE target_id = ?
     ORDER BY id DESC
     LIMIT 1`,
  ).get(sellerId) as { action_type: string; details: string | null };
  assert.equal(action.action_type, 'suspend_payouts');
  assert.match(action.details ?? '', /Manual fraud review/);
});

test('admin payouts list supports paginated response with metadata', async () => {
  seedAdminPayout('admin-page-1', 'failed');
  seedAdminPayout('admin-page-2', 'eligible');

  const result = await callAdmin('/api/admin/payouts?limit=1&offset=0');
  assert.equal(result.status, 200);

  const rows = Array.isArray(result.body.rows) ? result.body.rows : [];
  assert.equal(rows.length, 1);
  assert.ok(rows[0] && typeof rows[0] === 'object');

  const pagination = (result.body.pagination ?? {}) as {
    limit?: number;
    offset?: number;
    total?: number;
    hasMore?: boolean;
  };
  assert.equal(pagination.limit, 1);
  assert.equal(pagination.offset, 0);
  assert.ok(Number(pagination.total ?? 0) >= 2);
  assert.equal(typeof pagination.hasMore, 'boolean');
});

test('admin payouts list marks held payout retry-eligible when destination is verified and active', async () => {
  const { payoutId, destinationId } = seedAdminPayout('admin-held-retry', 'held');
  const db = getPaymentDb();
  db.prepare(
    `UPDATE seller_payout_accounts
     SET verification_status = 'verified',
         is_active = 1
     WHERE id = ?`,
  ).run(destinationId);
  db.prepare(`UPDATE payouts SET failure_reason = NULL WHERE id = ?`).run(payoutId);

  const result = await callAdmin('/api/admin/payouts?limit=50&offset=0');
  assert.equal(result.status, 200);
  const rows = Array.isArray(result.body.rows) ? result.body.rows : [];
  const row = rows.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return (entry as Record<string, unknown>).id === payoutId;
  }) as Record<string, unknown> | undefined;
  assert.ok(row);
  assert.equal(row.escrowState, 'released');
  assert.equal(row.retryEligible, true);
});

test('admin reconcile endpoint syncs provider status and terminal payout fields', async () => {
  const { payoutId } = seedAdminPayout('admin-reconcile');
  const originalFetch = global.fetch;
  const originalSecretKey = process.env.PAYCHANGU_SECRET_KEY;
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';

  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/details')) {
      return new Response(JSON.stringify({
        data: {
          transaction: {
            status: 'successful',
            reference: 'provider-ref-1',
            transaction_id: 'provider-tx-1',
            amount: 1470,
            currency: 'MWK',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const result = await callAdmin(`/api/admin/payouts/${payoutId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    assert.equal(result.status, 200);

    const db = getPaymentDb();
    const payout = db.prepare(
      `SELECT status, provider_ref_id, provider_transaction_id, provider_status
       FROM payouts
       WHERE id = ?`,
    ).get(payoutId) as {
      status: string;
      provider_ref_id: string | null;
      provider_transaction_id: string | null;
      provider_status: string | null;
    };
    assert.equal(payout.status, 'paid');
    assert.equal(payout.provider_ref_id, 'provider-ref-1');
    assert.equal(payout.provider_transaction_id, 'provider-tx-1');
    assert.equal(payout.provider_status, 'paid');

    const event = db.prepare(
      `SELECT event_type, actor_id
       FROM payout_events
       WHERE payout_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    ).get(payoutId) as { event_type: string; actor_id: string | null };
    assert.equal(event.event_type, 'payout_status_synced');
    assert.equal(event.actor_id, 'admin-user');
  } finally {
    global.fetch = originalFetch;
    if (originalSecretKey === undefined) {
      delete process.env.PAYCHANGU_SECRET_KEY;
    } else {
      process.env.PAYCHANGU_SECRET_KEY = originalSecretKey;
    }
  }
});
