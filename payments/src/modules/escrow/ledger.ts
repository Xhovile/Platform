import type { EscrowLedgerEntry } from '../../shared/types/payment';
import type { MoneyValue } from '../../shared/types/common';

export interface EscrowLedgerSnapshot {
  escrowId: string;
  entries: EscrowLedgerEntry[];
  balance: MoneyValue;
}

export function createEmptyEscrowLedger(escrowId: string, currency: string): EscrowLedgerSnapshot {
  return {
    escrowId,
    entries: [],
    balance: { amount: 0, currency },
  };
}

export function appendLedgerEntry(
  snapshot: EscrowLedgerSnapshot,
  entry: EscrowLedgerEntry,
): EscrowLedgerSnapshot {
  return {
    ...snapshot,
    entries: [...snapshot.entries, entry],
    balance: entry.balanceAfter,
  };
}

export function getEscrowBalance(snapshot: EscrowLedgerSnapshot): MoneyValue {
  return snapshot.balance;
}
