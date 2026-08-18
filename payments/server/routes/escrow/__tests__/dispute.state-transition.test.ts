import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAllowedDisputeTransition } from '../disputeState.js';

test('dispute state machine allows open -> resolved/rejected', () => {
  assert.doesNotThrow(() => assertAllowedDisputeTransition('open', 'resolved'));
  assert.doesNotThrow(() => assertAllowedDisputeTransition('open', 'rejected'));
});

test('dispute state machine blocks terminal-state changes', () => {
  assert.throws(
    () => assertAllowedDisputeTransition('resolved', 'open'),
    /Illegal dispute state transition: resolved -> open/,
  );
  assert.throws(
    () => assertAllowedDisputeTransition('rejected', 'resolved'),
    /Illegal dispute state transition: rejected -> resolved/,
  );
});
