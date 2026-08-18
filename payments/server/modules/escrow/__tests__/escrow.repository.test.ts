import assert from 'node:assert/strict';
import { test } from 'node:test';
import { query } from '../../../postgres.js';
import { escrowRepository } from '../escrow.repository.js';

const testOrderIds = [
  'escrow-release-accounting-1',
  'escrow-release-accounting-repeat',
  'escrow-release-accounting-held',
  'escrow-release-accounting-disputed',
  'escrow-refund-accounting-1',
  'escrow-refund-accounting-repeat',
  'escrow-refund-accounting-released',
];

async function clearEscrowRepositoryTestState(): Promise<void> {
  await query('DELETE FROM escrows WHERE order_id = ANY($1::text[])', [testOrderIds]);
}

async function releaseEntries(orderId: string) {
  return (await escrowRepository.findByOrderIdAsync(orderId))?.entries.filter((entry) => entry.entryType === 'release') ?? [];
}

async function refundEntries(orderId: string) {
  return (await escrowRepository.findByOrderIdAsync(orderId))?.entries.filter((entry) => entry.entryType === 'refund') ?? [];
}

test('releaseToSellerEarnings creates an audited release ledger entry and persists zero balance', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-release-accounting-1', 'MWK', 2500);
    const result = await escrowRepository.releaseToSellerEarningsAsync({
      orderId: 'escrow-release-accounting-1', releasedBy: 'buyer-accounting-1', reference: 'buyer-confirmed-delivery',
    });

    assert.ok(result);
    assert.equal(result.escrow.state, 'released');
    assert.equal(result.escrow.balanceAmount, 0);
    assert.equal(result.releaseEntry.entryType, 'release');
    assert.equal(result.releaseEntry.amount, 2500);
    assert.equal(result.releaseEntry.currency, 'MWK');
    assert.equal(result.releaseEntry.balanceAfter, 0);
    assert.equal(result.releaseEntry.actorId, 'buyer-accounting-1');
    assert.equal(result.releaseEntry.reference, 'buyer-confirmed-delivery');

    const persisted = await escrowRepository.findByOrderIdAsync('escrow-release-accounting-1');
    const persistedRelease = persisted?.entries.find((entry) => entry.entryType === 'release');
    assert.equal(persisted?.state, 'released');
    assert.equal(persisted?.balanceAmount, 0);
    assert.equal(persistedRelease?.id, result.releaseEntry.id);
    assert.equal(persistedRelease?.actorId, 'buyer-accounting-1');
    assert.equal(persistedRelease?.reference, 'buyer-confirmed-delivery');
  } finally {
    await clearEscrowRepositoryTestState();
  }
});

test('releaseToSellerEarnings rejects repeat release attempts without duplicating release ledger entries', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-release-accounting-repeat', 'MWK', 1800);
    await escrowRepository.releaseToSellerEarningsAsync({
      orderId: 'escrow-release-accounting-repeat', releasedBy: 'buyer-accounting-repeat', reference: 'first-release',
    });

    await assert.rejects(
      () => escrowRepository.releaseToSellerEarningsAsync({
        orderId: 'escrow-release-accounting-repeat', releasedBy: 'buyer-accounting-repeat', reference: 'second-release',
      }),
      /Escrow is already released/,
    );

    const releases = await releaseEntries('escrow-release-accounting-repeat');
    assert.equal(releases.length, 1);
    assert.equal(releases[0]?.reference, 'first-release');
  } finally {
    await clearEscrowRepositoryTestState();
  }
});

test('releaseToSellerEarnings validates escrow state transitions before appending a release ledger entry', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-release-accounting-held', 'MWK', 900);
    await escrowRepository.updateStateAsync('escrow-release-accounting-held', 'held');
    const result = await escrowRepository.releaseToSellerEarningsAsync({
      orderId: 'escrow-release-accounting-held', releasedBy: 'buyer-accounting-held', reference: 'held-release',
    });
    assert.ok(result);
    assert.equal(result.escrow.state, 'released');
    assert.equal(result.releaseEntry.reference, 'held-release');
    assert.equal((await releaseEntries('escrow-release-accounting-held')).length, 1);
  } finally {
    await clearEscrowRepositoryTestState();
  }
});

test('releaseToSellerEarnings rejects disputed escrows without appending release entries', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-release-accounting-disputed', 'MWK', 1200);
    await escrowRepository.updateStateAsync('escrow-release-accounting-disputed', 'disputed');
    await assert.rejects(
      () => escrowRepository.releaseToSellerEarningsAsync({
        orderId: 'escrow-release-accounting-disputed', releasedBy: 'buyer-accounting-disputed', reference: 'disputed-release',
      }),
      /Escrow cannot be released from disputed state/,
    );
    assert.equal((await releaseEntries('escrow-release-accounting-disputed')).length, 0);
  } finally {
    await clearEscrowRepositoryTestState();
  }
});

test('refundHeldBalance creates an audited refund ledger entry and persists zero balance', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-refund-accounting-1', 'MWK', 2100);
    const result = await escrowRepository.refundHeldBalanceAsync({
      orderId: 'escrow-refund-accounting-1', refundedBy: 'admin-refund-accounting-1', reference: 'admin-confirmed-refund', note: 'Buyer refund approved',
    });
    assert.ok(result);
    assert.equal(result.escrow.state, 'refunded');
    assert.equal(result.escrow.balanceAmount, 0);
    assert.equal(result.refundEntry.entryType, 'refund');
    assert.equal(result.refundEntry.amount, 2100);
    assert.equal(result.refundEntry.currency, 'MWK');
    assert.equal(result.refundEntry.balanceAfter, 0);
    assert.equal(result.refundEntry.actorId, 'admin-refund-accounting-1');
    assert.equal(result.refundEntry.reference, 'admin-confirmed-refund');
    assert.equal(result.refundEntry.note, 'Buyer refund approved');

    const persisted = await escrowRepository.findByOrderIdAsync('escrow-refund-accounting-1');
    const persistedRefund = persisted?.entries.find((entry) => entry.entryType === 'refund');
    assert.equal(persisted?.state, 'refunded');
    assert.equal(persisted?.balanceAmount, 0);
    assert.equal(persistedRefund?.id, result.refundEntry.id);
    assert.equal(persistedRefund?.actorId, 'admin-refund-accounting-1');
    assert.equal(persistedRefund?.reference, 'admin-confirmed-refund');
  } finally {
    await clearEscrowRepositoryTestState();
  }
});

test('refundHeldBalance rejects repeat refunds without duplicating refund ledger entries', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-refund-accounting-repeat', 'MWK', 1700);
    await escrowRepository.refundHeldBalanceAsync({
      orderId: 'escrow-refund-accounting-repeat', refundedBy: 'admin-refund-accounting-repeat', reference: 'first-refund', note: 'First refund',
    });
    await assert.rejects(
      () => escrowRepository.refundHeldBalanceAsync({
        orderId: 'escrow-refund-accounting-repeat', refundedBy: 'admin-refund-accounting-repeat', reference: 'second-refund', note: 'Second refund',
      }),
      /Escrow is already refunded/,
    );
    const refunds = await refundEntries('escrow-refund-accounting-repeat');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0]?.reference, 'first-refund');
  } finally {
    await clearEscrowRepositoryTestState();
  }
});

test('refundHeldBalance rejects released escrows without appending refund entries', async () => {
  await clearEscrowRepositoryTestState();
  try {
    await escrowRepository.createAsync('escrow-refund-accounting-released', 'MWK', 1900);
    await escrowRepository.releaseToSellerEarningsAsync({
      orderId: 'escrow-refund-accounting-released', releasedBy: 'buyer-refund-accounting-released', reference: 'already-released',
    });
    await assert.rejects(
      () => escrowRepository.refundHeldBalanceAsync({
        orderId: 'escrow-refund-accounting-released', refundedBy: 'admin-refund-accounting-released', reference: 'refund-after-release', note: 'Should not refund released escrow',
      }),
      /Escrow is already released/,
    );
    assert.equal((await refundEntries('escrow-refund-accounting-released')).length, 0);
  } finally {
    await clearEscrowRepositoryTestState();
  }
});
