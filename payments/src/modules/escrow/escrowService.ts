import type { EscrowLedgerEntry, MoneyValue } from '../../shared/types/payment';
import type { EscrowState } from '../../shared/types/payment';
import { appendLedgerEntry, createEmptyEscrowLedger, type EscrowLedgerSnapshot } from './ledger';
import { evaluateReleaseRule, type ReleaseRuleContext, type ReleaseRuleResult } from './releaseRules';

export interface EscrowRecord {
  id: string;
  orderId: string;
  state: EscrowState;
  currency: string;
  ledger: EscrowLedgerSnapshot;
}

export interface HoldEscrowRequest {
  escrowId: string;
  orderId: string;
  currency: string;
}

export interface EscrowServiceResult {
  escrow: EscrowRecord;
}

export class EscrowService {
  createEscrow(request: HoldEscrowRequest): EscrowRecord {
    return {
      id: request.escrowId,
      orderId: request.orderId,
      state: 'funded',
      currency: request.currency,
      ledger: createEmptyEscrowLedger(request.escrowId, request.currency),
    };
  }

  appendEntry(escrow: EscrowRecord, entry: EscrowLedgerEntry): EscrowRecord {
    return {
      ...escrow,
      ledger: appendLedgerEntry(escrow.ledger, entry),
      state: escrow.state,
    };
  }

  canRelease(context: ReleaseRuleContext): ReleaseRuleResult {
    return evaluateReleaseRule(context);
  }

  getBalance(escrow: EscrowRecord): MoneyValue {
    return escrow.ledger.balance;
  }
}

export const escrowService = new EscrowService();
