import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';
import {
  assertEscrowReleaseAccess,
  canAccessOrder,
  canReleaseEscrow,
} from '../shared.js';

type TestOrder = {
  buyerId: string;
  sellerId: string;
};

function requestFor(uid: string, isAdmin = false): Request {
  return {
    user: {
      uid,
      email: `${uid}@example.com`,
      is_admin: isAdmin,
    },
  } as Request;
}

function repositoryWith(order?: TestOrder) {
  return {
    findById: () => order,
  };
}

test('canReleaseEscrow allows the buyer even when the buyer is also a seller elsewhere', () => {
  const req = requestFor('seller-who-is-buying');
  const order = { buyerId: 'seller-who-is-buying', sellerId: 'merchant-seller' };

  assert.equal(canAccessOrder(req, order), true);
  assert.equal(canReleaseEscrow(req, order), true);
});

test('canReleaseEscrow denies the seller when they are not the buyer for the order', () => {
  const req = requestFor('merchant-seller');
  const order = { buyerId: 'buyer-1', sellerId: 'merchant-seller' };

  assert.equal(canAccessOrder(req, order), true);
  assert.equal(canReleaseEscrow(req, order), false);
});

test('canReleaseEscrow allows admins without removing their buyer capabilities', () => {
  const adminReq = requestFor('admin-user', true);
  const adminBuyerOrder = { buyerId: 'admin-user', sellerId: 'merchant-seller' };
  const adminManagedOrder = { buyerId: 'buyer-1', sellerId: 'merchant-seller' };

  assert.equal(canReleaseEscrow(adminReq, adminBuyerOrder), true);
  assert.equal(canReleaseEscrow(adminReq, adminManagedOrder), true);
});

test('assertEscrowReleaseAccess returns 403 for a seller-only release attempt', () => {
  const result = assertEscrowReleaseAccess(
    requestFor('merchant-seller'),
    'order-1',
    repositoryWith({ buyerId: 'buyer-1', sellerId: 'merchant-seller' }),
  );

  assert.deepEqual(result, {
    error: {
      status: 403,
      body: { error: 'Only the buyer or an admin can release escrow for this order' },
    },
  });
});

test('assertEscrowReleaseAccess returns 404 before authorization details for missing orders', () => {
  const result = assertEscrowReleaseAccess(
    requestFor('buyer-1'),
    'missing-order',
    repositoryWith(undefined),
  );

  assert.deepEqual(result, {
    error: {
      status: 404,
      body: { error: 'Order not found' },
    },
  });
});
