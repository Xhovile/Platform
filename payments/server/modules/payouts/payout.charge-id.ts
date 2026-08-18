export function buildPayChanguPayoutChargeId(payoutId: string, attemptNo: number): string {
  const safeAttemptNo = Number.isFinite(attemptNo) && attemptNo > 0 ? Math.trunc(attemptNo) : 1;
  return `BM-PO-${payoutId}-A${String(safeAttemptNo).padStart(2, '0')}`;
}
