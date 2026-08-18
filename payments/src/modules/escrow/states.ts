import type { EscrowState } from '../../shared/types/payment';

export const ESCROW_STATE_FLOW: EscrowState[] = [
  'funded',
  'held',
  'released',
  'refunded',
  'disputed',
  'closed',
];

export const ESCROW_TERMINAL_STATES: EscrowState[] = ['released', 'refunded', 'closed'];

export const ESCROW_ACTIVE_STATES: EscrowState[] = ['funded', 'held', 'disputed'];
