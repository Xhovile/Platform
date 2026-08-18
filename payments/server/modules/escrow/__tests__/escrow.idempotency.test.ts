import test from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../../postgres.js';
import { escrowRepository } from '../escrow.repository.js';

async function clearEscrows(): Promise<void> {
  await query('DELETE FROM escrows');
}

test('escrow creation is idempotent and never resets a released escrow', async () => {
  await clearEscrows();

  try {
    const first = await escrowRepository.createAsync('order_escrow_idempotent_1', 'MWK', 5000);
    const released = await escrowRepository.releaseToSellerEarningsAsync({
      orderId: first.orderId,
      releasedBy: 'system',
      reference: 'release-1',
    });

    assert.ok(released);
    assert.equal(released.escrow.state, 'released');
    assert.equal(released.escrow.balanceAmount, 0);

    const replay = await escrowRepository.createAsync(first.orderId, 'MWK', 5000);
    assert.equal(replay.id, first.id);
    assert.equal(replay.state, 'released');
    assert.equal(replay.balanceAmount, 0);
    assert.equal(replay.entries.filter((entry) => entry.entryType === 'credit').length, 1);
    assert.equal(replay.entries.filter((entry) => entry.entryType === 'release').length, 1);
  } finally {
    await clearEscrows();
  }
});

test('escrow creation is idempotent and never resets a refunded escrow', async () => {
  await clearEscrows();

  try {
    const first = await escrowRepository.createAsync('order_escrow_idempotent_2', 'MWK', 5000);
    const refunded = await escrowRepository.refundHeldBalanceAsync({
      orderId: first.orderId,
      refundedBy: 'system',
      reference: 'refund-1',
    });

    assert.ok(refunded);
    assert.equal(refunded.escrow.state, 'refunded');
    assert.equal(refunded.escrow.balanceAmount, 0);

    const replay = await escrowRepository.createAsync(first.orderId, 'MWK', 5000);
    assert.equal(replay.id, first.id);
    assert.equal(replay.state, 'refunded');
    assert.equal(replay.balanceAmount, 0);
    assert.equal(replay.entries.filter((entry) => entry.entryType === 'credit').length, 1);
    assert.equal(replay.entries.filter((entry) => entry.entryType === 'refund').length, 1);
  } finally {
    await clearEscrows();
  }
});
