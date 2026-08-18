import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import type { StoredOrder } from '../../modules/orders/order.repository.js';

export const disputeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a moment.' },
});

export const payoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a moment.' },
});

export const escrowActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a moment.' },
});

export function jsonError(error: unknown, fallback: string): { error: string } {
  return { error: error instanceof Error ? error.message : fallback };
}

export function getRequestUser(req: Request): { uid: string; is_admin?: boolean } | null {
  if (!req.user?.uid) return null;
  return { uid: req.user.uid, is_admin: req.user.is_admin === true };
}

export function canAccessOrder(req: Request, order: { buyerId: string; sellerId: string }): boolean {
  const user = getRequestUser(req);
  if (!user) return false;
  if (user.is_admin) return true;
  return user.uid === order.buyerId || user.uid === order.sellerId;
}

export function canReleaseEscrow(req: Request, order: { buyerId: string; sellerId: string }): boolean {
  const user = getRequestUser(req);
  if (!user) return false;
  if (user.is_admin) return true;
  return user.uid === order.buyerId;
}

type OrderAccessOrder = { buyerId: string; sellerId: string };

type OrderAccessDenied = {
  error: {
    status: number;
    body: { error: string };
  };
};

type OrderAccessGranted<TOrder extends OrderAccessOrder> = {
  order: TOrder;
};

type OrderAccessResult<TOrder extends OrderAccessOrder> =
  | OrderAccessDenied
  | OrderAccessGranted<TOrder>;

export function assertOrderAccess<TOrder extends OrderAccessOrder>(
  req: Request,
  orderId: string,
  orderRepository: { findById: (id: string) => TOrder | undefined },
): OrderAccessResult<TOrder> {
  const order = orderRepository.findById(orderId);

  if (!order) {
    return { error: { status: 404, body: { error: 'Order not found' } } };
  }

  if (!canAccessOrder(req, order)) {
    return {
      error: {
        status: 403,
        body: { error: 'You are not allowed to access this order' },
      },
    };
  }

  return { order };
}

export async function assertOrderAccessAsync(
  req: Request,
  orderId: string,
): Promise<OrderAccessResult<StoredOrder>> {
  const { orderRepository } = await import('../../modules/orders/order.repository.js');
  const order = await orderRepository.findByIdAsync(orderId);

  if (!order) {
    return { error: { status: 404, body: { error: 'Order not found' } } };
  }

  if (!canAccessOrder(req, order)) {
    return {
      error: {
        status: 403,
        body: { error: 'You are not allowed to access this order' },
      },
    };
  }

  return { order };
}

export async function assertEscrowReleaseAccessAsync(
  req: Request,
  orderId: string,
): Promise<OrderAccessResult<StoredOrder>> {
  const { orderRepository } = await import('../../modules/orders/order.repository.js');
  const order = await orderRepository.findByIdAsync(orderId);

  if (!order) {
    return { error: { status: 404, body: { error: 'Order not found' } } };
  }

  if (!canReleaseEscrow(req, order)) {
    return {
      error: {
        status: 403,
        body: { error: 'Only the buyer or an admin can release escrow for this order' },
      },
    };
  }

  return { order };
}

export function assertEscrowReleaseAccess<TOrder extends OrderAccessOrder>(
  req: Request,
  orderId: string,
  orderRepository: { findById: (id: string) => TOrder | undefined },
): OrderAccessResult<TOrder> {
  const order = orderRepository.findById(orderId);

  if (!order) {
    return { error: { status: 404, body: { error: 'Order not found' } } };
  }

  if (!canReleaseEscrow(req, order)) {
    return {
      error: {
        status: 403,
        body: { error: 'Only the buyer or an admin can release escrow for this order' },
      },
    };
  }

  return { order };
}
