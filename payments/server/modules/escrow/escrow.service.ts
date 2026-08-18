import type { EscrowLedgerEntry } from '../../../src/shared/types/payment.js';
import type { MoneyValue } from '../../../src/shared/types/common.js';
import type { EscrowState } from '../../../src/shared/types/payment.js';

export interface EscrowRecord {
  id: string;
  orderId: string;
  state: EscrowState;
  currency: string;
  balance: MoneyValue;
  entries: EscrowLedgerEntry[];
}

export type EscrowAccessActor = {
  uid: string;
  is_admin?: boolean;
};

export class EscrowService {
  createEscrow(orderId: string, currency: string, escrowId: string): EscrowRecord {
    return {
      id: escrowId,
      orderId,
      state: 'funded',
      currency,
      balance: { amount: 0, currency },
      entries: [],
    };
  }

  addEntry(record: EscrowRecord, entry: EscrowLedgerEntry): EscrowRecord {
    return {
      ...record,
      entries: [...record.entries, entry],
      balance: entry.balanceAfter,
    };
  }

  setState(record: EscrowRecord, state: EscrowState): EscrowRecord {
    return {
      ...record,
      state,
    };
  }

  canAccessEscrowPayoutState(actor: EscrowAccessActor | null, sellerId: string): boolean {
    if (!actor?.uid) return false;
    return actor.is_admin === true || actor.uid === sellerId;
  }

  canSellerRequestWithdrawal(actor: EscrowAccessActor | null, sellerId: string): boolean {
    return this.canAccessEscrowPayoutState(actor, sellerId);
  }

  canSellerRetryPayout(actor: EscrowAccessActor | null, sellerId: string): boolean {
    return this.canAccessEscrowPayoutState(actor, sellerId);
  }

  canAdminApproveOverride(actor: EscrowAccessActor | null): boolean {
    return actor?.is_admin === true;
  }
}

export const serverEscrowService = new EscrowService();