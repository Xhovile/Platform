import { PayoutRepository } from './payout.repository.js';
import { assertPayoutStatusTransition } from './payout.transitions.js';
import type { PayoutRecord, PayoutStatus } from './payout.shared.js';

/**
 * Financially safe repository facade.
 *
 * PayoutRepository remains responsible for SQL persistence and legacy queries.
 * This facade owns the one invariant that must apply to every status mutation.
 */
export class PayoutTransitionRepository extends PayoutRepository {
  override updateStatus(
    id: string,
    status: PayoutStatus,
    extra: Record<string, unknown> = {},
  ): PayoutRecord | undefined {
    const current = this.findById(id);
    if (!current) return undefined;

    assertPayoutStatusTransition(current.status, status);
    return super.updateStatus(id, status, extra);
  }
}

export const payoutRepository = new PayoutTransitionRepository();
