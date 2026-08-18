import express, { type RequestHandler } from 'express';
import { createBuyerEscrowRouter } from './escrow/buyerEscrowRoutes.js';
import { createDisputeRouter } from './escrow/disputeRoutes.js';
import { createPayoutRouter } from './escrow/payoutRoutes.js';

export {
  createBuyerEscrowRouter,
  createDisputeRouter,
  createPayoutRouter,
};

export function createEscrowRouter(requireAuth: RequestHandler): express.Router {
  return createBuyerEscrowRouter(requireAuth);
}
