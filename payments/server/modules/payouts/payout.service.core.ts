import './payout.schema.js';
import { payoutRepository, type PayoutTransitionRepository } from './payout.transition-repository.js';
import { executePayoutFlow, getProviderBalance } from './payout.service.execution.js';
import {
  reconcilePendingPayoutStatusesFlow,
  reconcilePayoutStatusFlow,
  reconcileProviderCallbackFlow,
} from './payout.service.reconciliation.js';
import { applyAdminOverrideAtomic } from './payout.admin-override.atomic.js';
import type { PoolClient } from 'pg';
import {
  type CreateConnectPayoutInput,
  type CreateEligiblePayoutInput,
  type ExecutePayoutInput,
  type PayoutRecord,
  type PayoutRequest,
  type ReconcileProviderCallbackInput,
} from './payout.shared.js';

export class PayoutService {
  constructor(private readonly repository: PayoutTransitionRepository = payoutRepository) {}

  findById(id: string): PayoutRecord | undefined {
    return this.repository.findById(id);
  }

  createEligiblePayoutCandidate(input: CreateEligiblePayoutInput): PayoutRecord {
    return this.repository.createEligibleForRelease(input);
  }

  async createEligiblePayoutCandidateAsync(input: CreateEligiblePayoutInput, client?: PoolClient): Promise<PayoutRecord> {
    return this.repository.createEligibleForReleaseAsync(input, client);
  }

  createConnectPayoutCandidate(input: CreateConnectPayoutInput): { payout: PayoutRecord; created: boolean } {
    return this.repository.createConnectPayoutCandidate(input);
  }

  addEvent(input: Parameters<PayoutTransitionRepository['addEvent']>[0]): void {
    this.repository.addEvent(input);
  }

  async addEventAsync(input: Parameters<PayoutTransitionRepository['addEvent']>[0], client?: PoolClient): Promise<void> {
    return this.repository.addEventAsync(input, client);
  }

  async executePayout(input: ExecutePayoutInput) {
    return executePayoutFlow(this.repository, input);
  }

  async getProviderBalance(currency = 'MWK') {
    return getProviderBalance(currency);
  }

  async reconcilePayoutStatus(input: {
    payoutId: string;
    actorType?: 'admin' | 'system';
    actorId?: string | null;
  }) {
    return reconcilePayoutStatusFlow(this.repository, input);
  }

  reconcileProviderCallback(input: ReconcileProviderCallbackInput): PayoutRecord | undefined {
    return reconcileProviderCallbackFlow(this.repository, input);
  }

  async reconcilePendingPayoutStatuses(input: {
    actorType?: 'admin' | 'system';
    actorId?: string | null;
    limit?: number;
  } = {}) {
    return reconcilePendingPayoutStatusesFlow(this.repository, input);
  }

  markPaid(payoutId: string, actorId: string, note?: string): PayoutRecord | undefined {
    return applyAdminOverrideAtomic(this.repository, {
      payoutId,
      action: 'mark_paid',
      actorId,
      reason: note,
    });
  }

  markFailed(payoutId: string, actorId: string, reason: string): PayoutRecord | undefined {
    return applyAdminOverrideAtomic(this.repository, {
      payoutId,
      action: 'mark_failed',
      actorId,
      reason,
    });
  }

  markHeld(payoutId: string, actorId: string, reason: string): PayoutRecord | undefined {
    return applyAdminOverrideAtomic(this.repository, {
      payoutId,
      action: 'hold',
      actorId,
      reason,
    });
  }

  applyAdminOverride(input: {
    payoutId: string;
    action: 'hold' | 'mark_paid' | 'mark_failed' | 'cancel';
    actorId: string;
    reason?: string | null;
    sellerId?: string | null;
  }): PayoutRecord | undefined {
    return applyAdminOverrideAtomic(this.repository, input);
  }

  processPayout(request: PayoutRequest) {
    return {
      status: 'processing',
      ...request,
    };
  }
}

export const payoutService = new PayoutService();