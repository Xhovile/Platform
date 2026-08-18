export interface Dispute {
  id: string;
  orderId: string;
  reason: string;
  status: 'open' | 'resolved' | 'rejected';
}

export class DisputeService {
  open(orderId: string, reason: string): Dispute {
    return {
      id: `dsp_${Date.now()}`,
      orderId,
      reason,
      status: 'open',
    };
  }

  resolve(dispute: Dispute): Dispute {
    return {
      ...dispute,
      status: 'resolved',
    };
  }
}

export const disputeService = new DisputeService();
