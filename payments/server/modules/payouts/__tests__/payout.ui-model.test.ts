import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sellerOperationalSignals,
  getVisibleAdminActions,
  getSellerPayoutFailureMeta,
} from '../../../../src/modules/payouts/uiModel.js';

test('seller operational signals include hold and verification blockers', () => {
  const messages = sellerOperationalSignals({
    status: 'held',
    destinationStatus: 'pending',
    retryAllowed: false,
    manualReviewPending: true,
    verificationBlockers: ['Update destination to continue'],
    failureReasonCode: 'provider_timeout',
  });

  assert.ok(messages.includes('Provider timeout'));
  assert.ok(messages.includes('Destination pending verification'));
  assert.ok(messages.includes('Payout held'));
  assert.ok(messages.includes('Awaiting admin review'));
  assert.ok(messages.includes('Update destination to continue'));
});

test('seller operational signals include provider failure and retry unavailable', () => {
  const messages = sellerOperationalSignals({
    status: 'failed',
    retryAllowed: false,
    failureReasonCode: 'provider_unavailable',
  });

  assert.ok(messages.includes('Provider unavailable'));
  assert.ok(messages.includes('Payout failed'));
  assert.ok(messages.includes('Retry unavailable'));
});

test('seller failure meta maps provider timeout', () => {
  assert.deepEqual(getSellerPayoutFailureMeta('provider_timeout'), {
    label: 'Provider timeout',
    detail: 'The provider did not respond in time, so the payout was paused.',
  });
});

test('seller failure meta maps provider unavailable', () => {
  assert.deepEqual(getSellerPayoutFailureMeta('provider_unavailable'), {
    label: 'Provider unavailable',
    detail: 'The provider service could not be reached, so the payout was paused.',
  });
});

test('seller failure meta returns null for unknown codes', () => {
  assert.equal(getSellerPayoutFailureMeta('something_else'), null);
});

test('admin action visibility is restricted to admins', () => {
  assert.deepEqual(getVisibleAdminActions(false), []);
  assert.deepEqual(getVisibleAdminActions(true), ['retry', 'mark_paid', 'hold', 'mark_failed', 'cancel']);
});
