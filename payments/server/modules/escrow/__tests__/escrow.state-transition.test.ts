import assert from 'node:assert/strict';
import test from 'node:test';
import { query } from '../../../postgres.js';
import { escrowRepository } from '../escrow.repository.js';

async function cleanup(orderId: string): Promise<void> {
  await query('DELETE FROM escrows WHERE order_id = $1', [orderId]);
}

test('escrow state machine allows funded -> released', async () => {
  const orderId = 'escrow-state-released-1';
  await cleanup(orderId);
  try {
    await escrowRepository.createAsync(orderId, 'MWK', 1000);
    assert.equal((await escrowRepository.updateStateAsync(orderId, 'held'))?.state, 'held');
    assert.equal((await escrowRepository.updateStateAsync(orderId, 'released'))?.state, 'released');
  } finally {
    await cleanup(orderId);
  }
});

test('escrow state machine allows funded -> refunded', async () => {
  const orderId = 'escrow-state-refunded-1';
  await cleanup(orderId);
  try {
    await escrowRepository.createAsync(orderId, 'MWK', 1000);
    assert.equal((await escrowRepository.updateStateAsync(orderId, 'refunded'))?.state, 'refunded');
  } finally {
    await cleanup(orderId);
  }
});

test('escrow state machine blocks refunded -> funded', async () => {
  const orderId = 'escrow-state-terminal-1';
  await cleanup(orderId);
  try {
    await escrowRepository.createAsync(orderId, 'MWK', 1000);
    await escrowRepository.updateStateAsync(orderId, 'refunded');
    await assert.rejects(
      () => escrowRepository.updateStateAsync(orderId, 'funded'),
      /Illegal escrow state transition: refunded -> funded/,
    );
    assert.equal((await escrowRepository.findByOrderIdAsync(orderId))?.state, 'refunded');
  } finally {
    await cleanup(orderId);
  }
});
