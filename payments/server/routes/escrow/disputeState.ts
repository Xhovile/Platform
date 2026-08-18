export type DisputeStatus = 'open' | 'resolved' | 'rejected';

const DISPUTE_ALLOWED_TRANSITIONS: Readonly<Record<DisputeStatus, readonly DisputeStatus[]>> = {
  open: ['open', 'resolved', 'rejected'],
  resolved: ['resolved'],
  rejected: ['rejected'],
} as const;

export function assertAllowedDisputeTransition(from: DisputeStatus, to: DisputeStatus): void {
  if (DISPUTE_ALLOWED_TRANSITIONS[from].includes(to)) return;
  throw new Error(`Illegal dispute state transition: ${from} -> ${to}`);
}
