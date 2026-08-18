import type { EscrowLedgerEntry } from '../../../src/shared/types/payment.js';
import type { MoneyValue } from '../../../src/shared/types/common.js';

export interface ServerEscrowLedger {
  escrowId: string;
  entries: EscrowLedgerEntry[];
  balance: MoneyValue;
}

export function createLedger(escrowId: string, currency: string): ServerEscrowLedger {
  return {
    escrowId,
    entries: [],
    balance: { amount: 0, currency },
  };
}

export function addLedgerEntry(ledger: ServerEscrowLedger, entry: EscrowLedgerEntry): ServerEscrowLedger {
  return {
    ...ledger,
    entries: [...ledger.entries, entry],
    balance: entry.balanceAfter,
  };
}
