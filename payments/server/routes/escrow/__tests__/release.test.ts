import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import { createEscrowRouter } from '../../escrowRoutes.js';
import { getPaymentDb } from '../../../postgresCompat.js';
import { escrowRepository } from '../../../modules/escrow/escrow.repository.js';
import { orderRepository } from '../../../modules/orders/order.repository.js';
import { serverOrderService } from '../../../modules/orders/order.service.js';
import { payoutRepository } from '../../../modules/payouts/payout.service.js';

const releasePayoutOrderId = 'order-release-payout-step-3';
const refundOrderId = 'order-refund-before-release-1';
const sellerId = 'seller-release-payout-1';
const destinationId = 'destination-release-payout-1';

const originalFetch = global.fetch;
const originalEnv = {
  PAYCHANGU_PAYOUT_BASE_URL: process.env.PAYCHANGU_PAYOUT_BASE_URL,
  PAYCHANGU_BASE_URL: process.env.PAYCHANGU_BASE_URL,
  PAYCHANGU_SECRET_KEY: process.env.PAYCHANGU_SECRET_KEY,
  PAYCHANGU_MOBILE_MONEY_PAYOUT_PATH: process.env.PAYCHANGU_MOBILE_MONEY_PAYOUT_PATH,
  PAYCHANGU_BANK_PAYOUT_PATH: process.env.PAYCHANGU_BANK_PAYOUT_PATH,
  PAYCHANGU_PAYOUT_STATUS_PATH: process.env.PAYCHANGU_PAYOUT_STATUS_PATH,
  PAYCHANGU_MOBILE_MONEY_PATH: process.env.PAYCHANGU_MOBILE_MONEY_PATH,
  PAYCHANGU_BANKS_PATH: process.env.PAYCHANGU_BANKS_PATH,
};

type CapturedRequest = {
  url: string;
  method: string;
  authorization: string | null;
  body: Record<string, unknown>;
};

function now(): string {
  return new Date().toISOString();
}

function createReleaseApp(uid: string, isAdmin = false): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/escrow', createEscrowRouter((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      uid,
      email: `${uid}@example.com`,
      is_admin: isAdmin,
    };
    next();
  }));
  return app;
}

function resetPayChanguState(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  global.fetch = originalFetch;
}

function useDefaultPayChanguEnv(): void {
  delete process.env.PAYCHANGU_PAYOUT_BASE_URL;
  delete process.env.PAYCHANGU_BASE_URL;
  delete process.env.PAYCHANGU_MOBILE_MONEY_PAYOUT_PATH;
  delete process.env.PAYCHANGU_BANK_PAYOUT_PATH;
  delete process.env.PAYCHANGU_PAYOUT_STATUS_PATH;
  delete process.env.PAYCHANGU_MOBILE_MONEY_PATH;
  delete process.env.PAYCHANGU_BANKS_PATH;
  process.env.PAYCHANGU_SECRET_KEY = 'test-secret-key';
}

function mockPayChanguFetch(): CapturedRequest[] {
  const requests: CapturedRequest[] = [];

  global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';

    const parsedUrl = new URL(url);

    // Forward any non-PayChangu requests (e.g., calls to the local test server)
    // to the original fetch implementation so tests can contact the server.
    const host = parsedUrl.hostname || '';
    if (!host.includes('paychangu') && !host.includes('api.paychangu.com')) {
      return originalFetch(input, init);
    }

    requests.push({
      url,
      method,
      authorization: headers.get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    });

    if (method === 'GET' && parsedUrl.pathname === '/wallet-balance') {
      return new Response(JSON.stringify({
        data: {
          main_balance: 5000,
          currency: 'MWK',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (
      method === 'POST' &&
      parsedUrl.pathname === '/mobile-money/payouts/initialize'
    ) {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          transaction: {
            status: 'pending',
            ref_id: 'mobile-ref',
            trans_id: 'mobile-trans',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (
      method === 'POST' &&
      parsedUrl.pathname === '/direct-charge/payouts/initialize'
    ) {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          transaction: {
            status: 'pending',
            ref_id: 'bank-ref',
            trans_id: 'bank-trans',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ status: 'success', data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return requests;
}

function clearReleasePayoutState(): void {
  const db = getPaymentDb();
  for (const orderId of [releasePayoutOrderId, refundOrderId]) {
    db.prepare('DELETE FROM payout_events WHERE payout_id IN (SELECT id FROM payouts WHERE order_id = ?)').run(orderId);
    db.prepare('DELETE FROM payout_attempts WHERE payout_id IN (SELECT id FROM payouts WHERE order_id = ?)').run(orderId);
    db.prepare('DELETE FROM payouts WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM escrow_events WHERE escrow_id IN (SELECT id FROM escrows WHERE order_id = ?)').run(orderId);
    db.prepare('DELETE FROM escrows WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  }
  db.prepare('DELETE FROM seller_payout_account_events WHERE seller_uid = ?').run(sellerId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE seller_uid = ?').run(sellerId);
  db.prepare('DELETE FROM sellers WHERE uid = ?').run(sellerId);
}

function seedVerifiedDestination(): void {
  const db = getPaymentDb();
  const stamp = now();

  db.prepare('INSERT INTO sellers (uid, email, is_verified) VALUES (?, ?, 1)')
    .run(sellerId, `${sellerId}@example.com`);

  db.prepare(
    `INSERT INTO seller_payout_accounts (
      id, seller_uid, destination_type, provider_name, provider_ref_id,
      currency, account_name, mobile_encrypted, masked_account, destination_fingerprint,
      is_default, verification_status, verification_attempts, is_active, created_at, updated_at
    ) VALUES (?, ?, 'mobile_money', 'paychangu', 'airtel-money', 'MWK', 'Release Test', '0990000000', '****0000', ?, 1, 'verified', 0, 1, ?, ?)`,
  ).run(destinationId, sellerId, randomUUID(), stamp, stamp);
}

function countPayoutAttempts(payoutId: string): number {
  const row = getPaymentDb()
    .prepare('SELECT COUNT(*) AS count FROM payout_attempts WHERE payout_id = ?')
    .get(payoutId) as { count: number };
  return row.count;
}

function countPayoutsForOrder(orderId: string): number {
  const row = getPaymentDb()
    .prepare('SELECT COUNT(*) AS count FROM payouts WHERE order_id = ?')
    .get(orderId) as { count: number };
  return row.count;
}

test('release endpoint creates a pending-settlement payout candidate without immediate PayChangu dispatch', async () => {
  clearReleasePayoutState();
  useDefaultPayChanguEnv();
  const requests = mockPayChanguFetch();

  const nowStamp = now();
  serverOrderService.create({
    id: releasePayoutOrderId,
    buyerId: 'buyer-release-payout-1',
    sellerId,
    source: 'listing',
    status: 'in_escrow',
    currency: 'MWK',
    subtotal: { amount: 1500, currency: 'MWK' },
    total: { amount: 1500, currency: 'MWK' },
    items: [{ listingId: 'listing-release-payout-1', title: 'Release Item', quantity: 1, unitPrice: { amount: 1500, currency: 'MWK' } }],
    createdAt: nowStamp,
    updatedAt: nowStamp,
  });
  serverOrderService.setStatus(releasePayoutOrderId, 'in_escrow');
  escrowRepository.create(releasePayoutOrderId, 'MWK', 1500);
  seedVerifiedDestination();

  const app = createReleaseApp('buyer-release-payout-1');
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/escrow/${releasePayoutOrderId}/release`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'buyer-confirmed-delivery' }),
    });

    assert.equal(response.status, 200, 'release should return 200');
    const body = await response.json() as {
      escrow?: { id?: string; state?: string; entries?: Array<{ id: string; entryType: string; actorId?: string; reference?: string }> };
      payout?: {
        id?: string;
        sellerId?: string;
        orderId?: string;
        escrowId?: string;
        releaseEntryId?: string;
        amount?: number;
        currency?: string;
        status?: string;
        provider?: string;
        providerChargeId?: string | null;
        providerStatus?: string | null;
        requestedBy?: string;
      };
      payoutEligibility?: { eligible?: boolean; reason?: string };
      payoutDispatch?: {
        reasonCode?: string | null;
        reason?: string;
        nextAction?: string;
        attempt?: {
          id?: string;
          attemptNo?: number;
          provider?: string;
          providerChargeId?: string;
          providerReference?: string;
          providerTransactionId?: string | null;
          status?: string;
        } | null;
        execution?: {
          provider?: string;
          providerChargeId?: string;
          providerReference?: string;
          providerTransactionId?: string | null;
          status?: string;
          processedAt?: string;
        } | null;
      };
    };

    const releaseEntry = body.escrow?.entries?.find((entry) => entry.entryType === 'release');

    assert.ok(body.escrow?.id, 'release response should include escrow');
    assert.equal(body.escrow?.state, 'released', 'escrow should be released');
    assert.equal(releaseEntry?.actorId, 'buyer-release-payout-1', 'release ledger should retain requester audit actor');
    assert.equal(releaseEntry?.reference, 'buyer-confirmed-delivery', 'release ledger should retain requester reference');
    assert.equal(body.payout?.sellerId, sellerId, 'payout should belong to the order seller');
    assert.equal(body.payout?.orderId, releasePayoutOrderId, 'payout should link to the order');
    assert.equal(body.payout?.escrowId, body.escrow?.id, 'payout should link to the escrow');
    assert.equal(body.payout?.releaseEntryId, releaseEntry?.id, 'payout should link to the release ledger entry');
    assert.equal(body.payout?.amount, 1410, 'payout should use the server-side net payout formula after payout fee');
    assert.equal(body.payout?.currency, 'MWK', 'payout should use the escrow currency');
    assert.equal(body.payout?.status, 'pending_settlement', 'payout should wait for PayChangu settlement before dispatch');
    assert.equal(body.payout?.provider, 'paychangu', 'payout should be prepared for PayChangu');
    assert.equal(body.payout?.providerStatus, null, 'payout should not have provider status before submission');
    assert.equal(body.payout?.requestedBy, 'buyer-release-payout-1', 'payout should record the releasing buyer as requester');

    assert.equal(body.payoutDispatch?.nextAction, 'awaiting_provider', 'dispatch should report awaiting provider');
    assert.equal(body.payoutDispatch?.reasonCode, null, 'dispatch should not report an error code');
    assert.equal(body.payoutDispatch?.attempt, null, 'release should not create a provider attempt before settlement');
    assert.equal(body.payoutDispatch?.execution, null, 'release should not execute provider payout before settlement');

    assert.equal(requests.length, 0, 'release should not call PayChangu before settlement');
    assert.equal(countPayoutsForOrder(releasePayoutOrderId), 1, 'release should persist exactly one payout candidate');
    assert.equal(countPayoutAttempts(body.payout?.id ?? ''), 0, 'release should not create a payout attempt before settlement');

    const savedPayout = payoutRepository.findByEscrowId(body.escrow?.id ?? '');
    assert.equal(savedPayout?.id, body.payout?.id, 'payout should be persisted for the escrow');
    assert.equal(savedPayout?.releaseEntryId, releaseEntry?.id, 'stored payout should link to release ledger entry');

    const formulaRow = getPaymentDb()
      .prepare(`SELECT gross_amount, platform_fee_amount, processing_fee_amount, reserve_amount, reserve_cap_amount,
                       manual_adjustment_amount, payout_fee_amount, seller_receives_amount, net_amount, formula_snapshot
                FROM payouts
                WHERE id = ?`)
      .get(body.payout?.id) as {
        gross_amount: number | null;
        platform_fee_amount: number | null;
        processing_fee_amount: number | null;
        reserve_amount: number | null;
        reserve_cap_amount: number | null;
        manual_adjustment_amount: number | null;
        payout_fee_amount: number | null;
        seller_receives_amount: number | null;
        net_amount: number | null;
        formula_snapshot: string | null;
      };

    assert.equal(formulaRow.gross_amount, 1500, 'payout should persist the gross formula amount');
    assert.equal(formulaRow.platform_fee_amount, 45, 'payout should persist the platform fee formula amount');
    assert.equal(formulaRow.processing_fee_amount, 0, 'payout should persist the processing fee formula amount');
    assert.equal(formulaRow.reserve_amount, 0, 'payout should persist the reserve formula amount');
    assert.equal(formulaRow.reserve_cap_amount, 90, 'payout should persist the reserve cap formula amount');
    assert.equal(formulaRow.manual_adjustment_amount, 0, 'payout should persist the manual adjustment formula amount');
    assert.equal(formulaRow.payout_fee_amount, 45, 'payout should persist the PayChangu transfer fee estimate');
    assert.equal(formulaRow.seller_receives_amount, 1410, 'payout should persist the seller amount after payout fee estimate');
    assert.equal(formulaRow.net_amount, 1410, 'payout should persist the net formula amount after payout fee');
    assert.deepEqual(JSON.parse(formulaRow.formula_snapshot ?? '{}'), {
      grossAmount: 1500,
      platformFeeAmount: 45,
      processingFeeAmount: 0,
      reserveAmount: 0,
      reserveCapAmount: 90,
      manualAdjustmentAmount: 0,
      payoutFeeAmount: 45,
      sellerReceivesAmount: 1410,
      netAmount: 1410,
      currency: 'MWK',
    });
    assert.equal(orderRepository.findById(releasePayoutOrderId)?.status, 'fulfilled', 'release should fulfill the order');
  } finally {
    server.close();
    resetPayChanguState();
    clearReleasePayoutState();
  }
});

test('release endpoint rejects sellers without releasing escrow or creating payouts', async () => {
  clearReleasePayoutState();
  useDefaultPayChanguEnv();

  const nowStamp = now();
  serverOrderService.create({
    id: releasePayoutOrderId,
    buyerId: 'buyer-release-payout-1',
    sellerId: sellerId,
    source: 'listing',
    status: 'pending_payment',
    currency: 'MWK',
    subtotal: { amount: 1500, currency: 'MWK' },
    total: { amount: 1500, currency: 'MWK' },
    items: [{ listingId: 'listing-release-payout-1', title: 'Release Item', quantity: 1, unitPrice: { amount: 1500, currency: 'MWK' } }],
    createdAt: nowStamp,
    updatedAt: nowStamp,
  });
  escrowRepository.create(releasePayoutOrderId, 'MWK', 1500);

  const app = createReleaseApp('seller-release-payout-1');
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/escrow/${releasePayoutOrderId}/release`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'seller-should-not-release' }),
    });

    assert.equal(response.status, 403, 'seller should not be allowed to release escrow for their own order');
    const body = await response.json() as { error?: string };
    assert.equal(body.error, 'Only the buyer or an admin can release escrow for this order');
    assert.equal(escrowRepository.findByOrderId(releasePayoutOrderId)?.state, 'funded', 'escrow should remain funded');
    assert.equal(countPayoutsForOrder(releasePayoutOrderId), 0, 'seller release attempt should not create a payout candidate');
    assert.equal(orderRepository.findById(releasePayoutOrderId)?.status, 'pending_payment', 'seller release attempt should not fulfill the order');
  } finally {
    server.close();
    resetPayChanguState();
    clearReleasePayoutState();
  }
});


test('refund endpoint records a pre-release escrow refund ledger entry and zeroes balance', async () => {
  clearReleasePayoutState();

  const nowStamp = now();
  serverOrderService.create({
    id: refundOrderId,
    buyerId: 'buyer-refund-before-release-1',
    sellerId: sellerId,
    source: 'listing',
    status: 'in_escrow',
    currency: 'MWK',
    subtotal: { amount: 1600, currency: 'MWK' },
    total: { amount: 1600, currency: 'MWK' },
    items: [{ listingId: 'listing-refund-before-release-1', title: 'Refund Item', quantity: 1, unitPrice: { amount: 1600, currency: 'MWK' } }],
    createdAt: nowStamp,
    updatedAt: nowStamp,
  });
  escrowRepository.create(refundOrderId, 'MWK', 1600);

  const app = createReleaseApp('admin-refund-before-release-1', true);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/escrow/${refundOrderId}/refund`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Buyer requested cancellation before release' }),
    });

    assert.equal(response.status, 200, 'admin should be able to refund held escrow before release');
    const body = await response.json() as {
      escrow?: { id?: string; state?: string; balanceAmount?: number; entries?: Array<{ entryType: string; amount: number; balanceAfter: number; actorId?: string; note?: string }> };
      refundEntry?: { entryType?: string; amount?: number; balanceAfter?: number; actorId?: string; note?: string };
      cancelledPayouts?: unknown[];
    };

    assert.equal(body.escrow?.state, 'refunded', 'refund should mark escrow as refunded');
    assert.equal(body.escrow?.balanceAmount, 0, 'refund should zero the escrow balance');
    assert.equal(body.refundEntry?.entryType, 'refund', 'response should include the refund ledger entry');
    assert.equal(body.refundEntry?.amount, 1600, 'refund ledger should record held balance amount');
    assert.equal(body.refundEntry?.balanceAfter, 0, 'refund ledger should settle escrow balance');
    assert.equal(body.refundEntry?.actorId, 'admin-refund-before-release-1', 'refund ledger should audit the admin actor');
    assert.equal(body.refundEntry?.note, 'Buyer requested cancellation before release', 'refund ledger should keep the admin reason');
    assert.deepEqual(body.cancelledPayouts, [], 'pre-release refund should not create or leave a payout');

    const persisted = escrowRepository.findByOrderId(refundOrderId);
    const persistedRefund = persisted?.entries.find((entry) => entry.entryType === 'refund');
    assert.equal(persisted?.state, 'refunded', 'refunded state should be persisted');
    assert.equal(persisted?.balanceAmount, 0, 'zero balance should be persisted');
    assert.equal(persistedRefund?.amount, 1600, 'persisted refund ledger should record amount');
    assert.equal(countPayoutsForOrder(refundOrderId), 0, 'refund before release should not create payout candidate');
    assert.equal(orderRepository.findById(refundOrderId)?.status, 'refunded', 'refund should mark order refunded');
  } finally {
    server.close();
    clearReleasePayoutState();
  }
});

test('refund endpoint requires admin and a reason', async () => {
  clearReleasePayoutState();

  const nowStamp = now();
  serverOrderService.create({
    id: refundOrderId,
    buyerId: 'buyer-refund-before-release-1',
    sellerId: sellerId,
    source: 'listing',
    status: 'in_escrow',
    currency: 'MWK',
    subtotal: { amount: 1600, currency: 'MWK' },
    total: { amount: 1600, currency: 'MWK' },
    items: [{ listingId: 'listing-refund-before-release-1', title: 'Refund Item', quantity: 1, unitPrice: { amount: 1600, currency: 'MWK' } }],
    createdAt: nowStamp,
    updatedAt: nowStamp,
  });
  escrowRepository.create(refundOrderId, 'MWK', 1600);

  const sellerApp = createReleaseApp(sellerId);
  const sellerServer = sellerApp.listen(0);
  const sellerPort = (sellerServer.address() as { port: number }).port;

  try {
    const sellerResponse = await fetch(`http://127.0.0.1:${sellerPort}/api/escrow/${refundOrderId}/refund`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Seller should not refund' }),
    });
    assert.equal(sellerResponse.status, 403, 'non-admin should not refund escrow');
  } finally {
    sellerServer.close();
  }

  const adminApp = createReleaseApp('admin-refund-before-release-1', true);
  const adminServer = adminApp.listen(0);
  const adminPort = (adminServer.address() as { port: number }).port;

  try {
    const noReasonResponse = await fetch(`http://127.0.0.1:${adminPort}/api/escrow/${refundOrderId}/refund`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '   ' }),
    });
    assert.equal(noReasonResponse.status, 400, 'admin refund should require a reason');
    assert.equal(escrowRepository.findByOrderId(refundOrderId)?.state, 'funded', 'validation failure should not refund escrow');
    assert.equal(escrowRepository.findByOrderId(refundOrderId)?.balanceAmount, 1600, 'validation failure should preserve balance');
    assert.equal(orderRepository.findById(refundOrderId)?.status, 'pending_payment', 'validation failure should preserve order status');
  } finally {
    adminServer.close();
    clearReleasePayoutState();
  }
});


test('refund endpoint cancels manual payouts linked to the order escrow before refunding', async () => {
  clearReleasePayoutState();

  const nowStamp = now();
  serverOrderService.create({
    id: refundOrderId,
    buyerId: 'buyer-refund-before-release-1',
    sellerId,
    source: 'listing',
    status: 'in_escrow',
    currency: 'MWK',
    subtotal: { amount: 1600, currency: 'MWK' },
    total: { amount: 1600, currency: 'MWK' },
    items: [{ listingId: 'listing-refund-before-release-1', title: 'Refund Item', quantity: 1, unitPrice: { amount: 1600, currency: 'MWK' } }],
    createdAt: nowStamp,
    updatedAt: nowStamp,
  });
  const escrow = escrowRepository.create(refundOrderId, 'MWK', 1600);

  const db = getPaymentDb();
  db.prepare('INSERT INTO sellers (uid, email, is_verified) VALUES (?, ?, 1)')
    .run(sellerId, `${sellerId}@example.com`);
  db.prepare(
    `INSERT INTO payouts (
      id,
      seller_id,
      order_id,
      escrow_id,
      release_entry_id,
      amount,
      currency,
      status,
      requested_by,
      requested_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, NULL, 900, 'MWK', 'eligible', ?, ?, ?, ?)`,
  ).run(
    'manual-payout-refund-cancel-1',
    sellerId,
    refundOrderId,
    escrow.id,
    'admin-manual-payout',
    nowStamp,
    nowStamp,
    nowStamp,
  );

  const app = createReleaseApp('admin-refund-before-release-1', true);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/escrow/${refundOrderId}/refund`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Buyer refund should stop manual payout' }),
    });

    assert.equal(response.status, 200, 'refund should succeed after cancelling linked manual payout');
    const body = await response.json() as { cancelledPayouts?: Array<{ id?: string; status?: string }> };
    assert.equal(body.cancelledPayouts?.length, 1, 'refund should report the cancelled manual payout');
    assert.equal(body.cancelledPayouts?.[0]?.id, 'manual-payout-refund-cancel-1');
    assert.equal(body.cancelledPayouts?.[0]?.status, 'cancelled');

    const payout = db.prepare('SELECT status, release_entry_id, failure_reason FROM payouts WHERE id = ?')
      .get('manual-payout-refund-cancel-1') as { status: string; release_entry_id: string | null; failure_reason: string | null };
    assert.equal(payout.release_entry_id, null, 'regression payout should be a manual payout without a release entry');
    assert.equal(payout.status, 'cancelled', 'linked manual payout should be cancelled before refund completes');
    assert.equal(payout.failure_reason, 'payout_cancelled');
    assert.equal(escrowRepository.findByOrderId(refundOrderId)?.state, 'refunded', 'escrow should still be refunded');
  } finally {
    server.close();
    clearReleasePayoutState();
  }
});
