import assert from 'node:assert/strict';
import test from 'node:test';
import { getPaymentDb } from '../../../postgresCompat.js';
import { paymentRepository } from '../payment.repository.js';

function seed(reference: string): void {
  const now = new Date().toISOString();
  paymentRepository.save({
    id: `state-${reference}`,
    orderId: `order-${reference}`,
    provider: 'paychangu',
    method: 'mobile_money',
    status: 'pending',
    amount: { amount: 1000, currency: 'MWK' },
    reference,
    providerReference: null,
    checkoutUrl: null,
    paidAt: null,
    rawResponse: {},
    verified: false,
    createdAt: now,
    updatedAt: now,
  });
}

function cleanup(reference: string): void {
  getPaymentDb().prepare('DELETE FROM payments WHERE reference = ?').run(reference);
}

test('payment state machine allows pending -> captured -> refunded', () => {
  const reference = 'payment-state-normal-1';
  cleanup(reference);
  seed(reference);
  try {
    assert.equal(paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'captured', verified: true }))?.status, 'captured');
    assert.equal(paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'refunded', verified: false }))?.status, 'refunded');
  } finally {
    cleanup(reference);
  }
});

test('payment state machine preserves valid failed -> captured recovery', () => {
  const reference = 'payment-state-retry-1';
  cleanup(reference);
  seed(reference);
  try {
    paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'failed' }));
    assert.equal(paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'captured', verified: true }))?.status, 'captured');
  } finally {
    cleanup(reference);
  }
});

test('payment state machine blocks refunded -> captured resurrection', () => {
  const reference = 'payment-state-refunded-1';
  cleanup(reference);
  seed(reference);
  try {
    paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'captured', verified: true }));
    paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'refunded', verified: false }));
    assert.throws(
      () => paymentRepository.updateByReference(reference, (current) => ({ ...current, status: 'captured', verified: true })),
      /Illegal payment state transition: refunded -> captured/,
    );
    assert.equal(paymentRepository.findByReference(reference)?.status, 'refunded');
  } finally {
    cleanup(reference);
  }
});
