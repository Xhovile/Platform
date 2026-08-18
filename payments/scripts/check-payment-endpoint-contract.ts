import assert from 'node:assert/strict';
import { ENDPOINTS } from '../src/shared/api/endpoints';
import { PAYMENT_ENDPOINTS } from '../server/modules/payments/payment.endpoints';

function run(): void {
  assert.equal(
    ENDPOINTS.payments.paychangu.create,
    PAYMENT_ENDPOINTS.paychangu.create,
    'PayChangu create endpoint drifted between client and server endpoint maps',
  );

  assert.equal(
    decodeURIComponent(ENDPOINTS.payments.paychangu.verify(':txRef')),
    PAYMENT_ENDPOINTS.paychangu.verify,
    'PayChangu verify endpoint drifted between client and server endpoint maps',
  );

  assert.equal(
    ENDPOINTS.payments.paychangu.webhook,
    PAYMENT_ENDPOINTS.paychangu.webhook,
    'PayChangu webhook endpoint drifted between client and server endpoint maps',
  );

  console.log('Payment endpoint contract check passed.');
}

run();
