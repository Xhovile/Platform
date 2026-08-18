import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createEscrowRouter } from '../../escrowRoutes.js';
import { getPaymentDb } from '../../../postgresCompat.js';
import { escrowRepository } from '../../../modules/escrow/escrow.repository.js';
import { orderRepository } from '../../../modules/orders/order.repository.js';
import { serverOrderService } from '../../../modules/orders/order.service.js';
import { payoutRepository } from '../../../modules/payouts/payout.service.js';

const orderId = 'order-release-payout-audit';

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

function clearState(): void {
  const db = getPaymentDb();
  db.prepare('DELETE FROM payout_events WHERE payout_id IN (SELECT id FROM payouts WHERE order_id = ?)').run(orderId);
  db.prepare('DELETE FROM payouts WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM escrows WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM seller_payout_accounts WHERE seller_uid = ?').run('seller-release-audit');
  db.prepare('DELETE FROM sellers WHERE uid = ?').run('seller-release-audit');
}

test('release creates payout_released audit event with formula snapshot', async () => {
  clearState();

  const now = new Date().toISOString();
  serverOrderService.create({
    id: orderId,
    buyerId: 'buyer-release-audit',
    sellerId: 'seller-release-audit',
    source: 'listing',
    status: 'in_escrow',
    currency: 'MWK',
    subtotal: { amount: 1500, currency: 'MWK' },
    total: { amount: 1500, currency: 'MWK' },
    items: [{ listingId: 'listing-release-audit', title: 'Audit Item', quantity: 1, unitPrice: { amount: 1500, currency: 'MWK' } }],
    createdAt: now,
    updatedAt: now,
  });
  serverOrderService.setStatus(orderId, 'in_escrow');
  escrowRepository.create(orderId, 'MWK', 1500);

  const app = createReleaseApp('buyer-release-audit');
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/escrow/${orderId}/release`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'buyer-confirmed-delivery' }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { payout?: { id?: string; amount?: number } };
    assert.ok(body.payout?.id);
    assert.equal(body.payout?.amount, 1455);

    const auditRows = getPaymentDb()
      .prepare(`SELECT event_type, actor_type, actor_id, note, payload
                FROM payout_events
                WHERE payout_id = ?
                ORDER BY id ASC`)
      .all(body.payout?.id) as Array<{ event_type: string; actor_type: string; actor_id: string | null; note: string | null; payload: string | null }>;

    assert.ok(auditRows.length >= 1, 'release should create at least one payout audit event');
    const releasedEvent = auditRows.find((row) => row.event_type === 'payout_released');
    assert.ok(releasedEvent, 'release should emit payout_released');
    assert.equal(releasedEvent?.actor_type, 'buyer');
    assert.equal(releasedEvent?.actor_id, 'buyer-release-audit');
    assert.match(releasedEvent?.payload ?? '', /payoutFormula/);
    assert.match(releasedEvent?.payload ?? '', /releaseEntryId/);

    const saved = payoutRepository.findByEscrowId(escrowRepository.findByOrderId(orderId)?.id ?? '');
    assert.equal(saved?.id, body.payout?.id);
    assert.equal(orderRepository.findById(orderId)?.status, 'fulfilled');
  } finally {
    server.close();
    clearState();
  }
});
