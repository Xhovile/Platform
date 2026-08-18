import { useMemo } from 'react';
import { escrowService, type EscrowRecord, type EscrowService, type HoldEscrowRequest } from '../escrowService';
import type { EscrowLedgerEntry, MoneyValue } from '../../../shared/types/payment';
import type { ReleaseRuleContext, ReleaseRuleResult } from '../releaseRules';

export interface UseEscrowResult {
  createEscrow: (request: HoldEscrowRequest) => EscrowRecord;
  appendEntry: (escrow: EscrowRecord, entry: EscrowLedgerEntry) => EscrowRecord;
  canRelease: (context: ReleaseRuleContext) => ReleaseRuleResult;
  getBalance: (escrow: EscrowRecord) => MoneyValue;
}

export function useEscrow(): UseEscrowResult {
  return useMemo(() => ({
    createEscrow: (request) => escrowService.createEscrow(request),
    appendEntry: (escrow, entry) => escrowService.appendEntry(escrow, entry),
    canRelease: (context) => escrowService.canRelease(context),
    getBalance: (escrow) => escrowService.getBalance(escrow),
  }), []);
}
