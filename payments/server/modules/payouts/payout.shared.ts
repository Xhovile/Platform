import { createDecipheriv, scryptSync } from 'crypto';
import type { MoneyValue } from '../../../src/shared/types/common.js';
import { PAYOUT_POLICY } from './payout.policy.js';
import type { PayChanguPayoutFailureClass } from './paychangu.payout.js';

export type PayoutStatus =
  | 'eligible'
  | 'pending_settlement'
  | 'ready_for_payout'
  | 'queued'
  | 'processing'
  | 'pending'
  | 'held'
  | 'paid'
  | 'failed'
  | 'cancelled';

export interface PayoutRecord {
  id: string;
  sellerId: string;
  orderId: string | null;
  escrowId: string | null;
  releaseEntryId: string | null;
  destinationAccountId: string | null;
  amount: number;
  currency: string;
  status: PayoutStatus;
  provider: string | null;
  providerChargeId: string | null;
  providerStatus?: string | null;
  lastAttemptId?: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayoutAttemptRecord {
  id: string;
  payoutId: string;
  provider: string;
  providerChargeId: string;
  providerReference: string | null;
  providerTransactionId: string | null;
  status: PayoutStatus;
  attemptNo: number;
  rawResponse: Record<string, unknown>;
  createdAt: string;
}

export interface CreateEligiblePayoutInput {
  sellerId: string;
  orderId: string;
  escrowId: string;
  releaseEntryId: string;
  amount: number;
  grossAmount: number;
  platformFeeAmount: number;
  processingFeeAmount: number;
  reserveAmount: number;
  reserveCapAmount: number;
  manualAdjustmentAmount: number;
  payoutFeeAmount?: number;
  sellerReceivesAmount?: number;
  netAmount: number;
  formulaSnapshot: Record<string, unknown>;
  currency: string;
  requestedBy: string;
  requestedAt?: string;
  destinationAccountId?: string | null;
  snapshot?: Record<string, unknown> | null;
}

export interface CreateConnectPayoutInput {
  sellerId: string;
  orderId: string;
  amount: number;
  grossAmount: number;
  platformFeeAmount: number;
  processingFeeAmount: number;
  reserveAmount: number;
  reserveCapAmount: number;
  manualAdjustmentAmount: number;
  payoutFeeAmount?: number;
  sellerReceivesAmount?: number;
  netAmount: number;
  formulaSnapshot: Record<string, unknown>;
  currency: string;
  requestedBy: string;
  requestedAt?: string;
  destinationAccountId?: string | null;
  snapshot?: Record<string, unknown> | null;
}

export interface PayoutRequest {
  sellerId: string;
  amount: MoneyValue;
}

export interface ExecutePayoutInput {
  payoutId: string;
  sellerId?: string;
  amount?: number;
  currency?: string;
  providerName?: string;
  destinationReference?: string;
  actorType?: 'admin' | 'system';
  actorId?: string | null;
}

export interface ReconcileProviderCallbackInput {
  payoutId: string;
  status: PayoutStatus;
  providerChargeId?: string | null;
  providerReference?: string | null;
  providerTransactionId?: string | null;
  rawPayload?: unknown;
  eventId?: string | number | null;
}

export type AdminOverrideAction = 'hold' | 'mark_paid' | 'mark_failed' | 'cancel';

export type PayoutPermissionActor = {
  uid: string;
  is_admin?: boolean;
};

export type PayoutPermissionContext = {
  sellerId: string;
  actor: PayoutPermissionActor | null;
};

export type PayoutNextAction =
  | 'manual_review'
  | 'retry_blocked'
  | 'awaiting_provider'
  | 'none';

const PAYOUT_ENCRYPTION_SECRET = process.env.SELLER_PAYOUT_ENCRYPTION_KEY ?? '';

export function isProviderHoldFailure(reasonCode: PayChanguPayoutFailureClass): boolean {
  return reasonCode !== null;
}

export function classifyProviderFailureFromError(error: unknown): PayChanguPayoutFailureClass {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('rate-limit') ||
      message.includes('too many requests')
    ) {
      return 'provider_rate_limited';
    }
    if (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('etimedout')
    ) {
      return 'provider_timeout';
    }
  }
  return 'provider_unavailable';
}

export function exactProviderErrorMessage(rawResponse: unknown): string | null {
  const extract = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      try {
        const parsed = JSON.parse(trimmed);
        return extract(parsed) ?? trimmed;
      } catch {
        return trimmed;
      }
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;

    for (const key of ['message', 'error', 'detail', 'reason', 'rawText']) {
      const found = extract(record[key]);
      if (found) return found;
    }

    if (record.response) {
      return extract(record.response);
    }

    return null;
  };

  return extract(rawResponse);
}

export function providerFailureReason(
  reasonCode: PayChanguPayoutFailureClass,
  exactMessage?: string | null,
): string {
  if (reasonCode === 'provider_rate_limited') {
    return exactMessage
      ? `Provider rate-limited: ${exactMessage}`
      : 'Provider rate-limited';
  }

  if (reasonCode === 'provider_timeout') {
    return exactMessage
      ? `Provider timeout: ${exactMessage}`
      : 'Provider timeout';
  }

  if (reasonCode === 'provider_unavailable') {
    return exactMessage
      ? `Provider unavailable: ${exactMessage}`
      : 'Provider unavailable';
  }

  return exactMessage ?? 'Payout failed';
}

export function canViewPayoutSettings(context: PayoutPermissionContext): boolean {
  return Boolean(context.actor?.is_admin || context.actor?.uid === context.sellerId);
}

export function canEditPayoutSettings(context: PayoutPermissionContext): boolean {
  return Boolean(context.actor?.is_admin || context.actor?.uid === context.sellerId);
}

export function canRequestWithdrawal(context: PayoutPermissionContext): boolean {
  return Boolean(context.actor?.is_admin || context.actor?.uid === context.sellerId);
}

export function canViewPayoutHistory(context: PayoutPermissionContext): boolean {
  return Boolean(context.actor?.is_admin || context.actor?.uid === context.sellerId);
}

export function canRequestPayoutRetry(context: PayoutPermissionContext): boolean {
  return Boolean(context.actor?.is_admin || context.actor?.uid === context.sellerId);
}

export function canApprovePayoutOverride(context: PayoutPermissionContext): boolean {
  return Boolean(context.actor?.is_admin);
}

export function decryptSensitiveValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!PAYOUT_ENCRYPTION_SECRET) return value;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const [ivPart, encryptedPart] = trimmed.split(':');
  if (!ivPart || !encryptedPart) return trimmed;

  try {
    const key = scryptSync(PAYOUT_ENCRYPTION_SECRET, 'seller-payout-key', 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    return decrypted || null;
  } catch {
    return trimmed;
  }
}