import type { EntityId, ISODateString, Timestamped } from '../../shared/types/common';
import type { EscrowState } from '../../shared/types/payment';

export type DisputeStatus = 'open' | 'under_review' | 'awaiting_response' | 'resolved' | 'rejected' | 'closed';
export type DisputeReason = 'item_not_received' | 'item_not_as_described' | 'duplicate_payment' | 'seller_unreachable' | 'other';

export interface EscrowDispute extends Timestamped {
  id: EntityId;
  escrowId: EntityId;
  orderId: EntityId;
  openedBy: 'buyer' | 'seller' | 'admin';
  reason: DisputeReason;
  status: DisputeStatus;
  stateAtOpen: EscrowState;
  summary: string;
  resolution?: string | null;
  resolvedAt?: ISODateString | null;
}

export interface DisputeComment extends Timestamped {
  id: EntityId;
  disputeId: EntityId;
  authorId: EntityId;
  authorRole: 'buyer' | 'seller' | 'admin' | 'support';
  body: string;
}
