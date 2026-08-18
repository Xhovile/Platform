export type SellerPayoutSignalInput = {
  status: string;
  destinationStatus?: string | null;
  retryAllowed?: boolean | null;
  manualReviewPending?: boolean | null;
  verificationBlockers?: string[] | null;
  failureReasonCode?: string | null;
};

export type SellerPayoutLaunchStatus =
  | 'eligible'
  | 'pending_settlement'
  | 'ready_for_payout'
  | 'queued_for_admin_review'
  | 'sent_to_paychangu'
  | 'provider_pending'
  | 'paid'
  | 'held'
  | 'needs_destination_update'
  | 'cancelled';

export type SellerPayoutLaunchStatusMeta = {
  label: string;
  detail: string;
};

type ProviderFailureReasonCode =
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'provider_execution_failed'
  | 'destination_not_verified'
  | 'destination_incomplete'
  | 'order_not_releasable'
  | 'manual_review_required'
  | 'payout_not_found'
  | 'payout_cancelled';

export type SellerPayoutFailureMeta = {
  label: string;
  detail: string;
};

const LAUNCH_STATUS_META: Record<SellerPayoutLaunchStatus, SellerPayoutLaunchStatusMeta> = {
  eligible: {
    label: 'Eligible for payout',
    detail: 'Released funds are ready to enter the payout queue.',
  },
  queued_for_admin_review: {
    label: 'Queued for admin review',
    detail: 'The payout is waiting for approval before it is sent.',
  },
  sent_to_paychangu: {
    label: 'Sent to provider',
    detail: 'The payout has been submitted for processing.',
  },
  provider_pending: {
    label: 'Provider pending',
    detail: 'The provider or destination network is still processing the payout.',
  },
  paid: {
    label: 'Paid',
    detail: 'The seller payout has been completed successfully.',
  },
  held: {
    label: 'Held',
    detail: 'The payout is paused while the issue is reviewed.',
  },
  needs_destination_update: {
    label: 'Needs destination update',
    detail: 'The payout destination must be updated or verified before release.',
  },
  cancelled: {
    label: 'Cancelled',
    detail: 'The payout was cancelled and will not be sent in its current state.',
  },
  pending_settlement: {
    label: 'Awaiting settlement',
    detail: 'Funds are still settling from collection balance before payout can be sent.',
  },
  ready_for_payout: {
    label: 'Ready for payout',
    detail: 'Settled funds are available and the payout can be sent now.',
  },
};

const FAILURE_REASON_META: Record<ProviderFailureReasonCode, SellerPayoutFailureMeta> = {
  provider_timeout: {
    label: 'Provider timeout',
    detail: 'The provider did not respond in time, so the payout was paused.',
  },
  provider_unavailable: {
    label: 'Provider unavailable',
    detail: 'The provider service could not be reached, so the payout was paused.',
  },
  provider_rate_limited: {
    label: 'Rate limited by provider',
    detail: 'Too many payout requests were sent too quickly, so the payout was paused.',
  },
  provider_execution_failed: {
    label: 'Payout submission failed',
    detail: 'The payout request was rejected or failed during submission.',
  },
  destination_not_verified: {
    label: 'Destination not verified',
    detail: 'The seller payout destination still needs verification before money can be sent.',
  },
  destination_incomplete: {
    label: 'Destination details incomplete',
    detail: 'The seller payout destination is missing required details.',
  },
  order_not_releasable: {
    label: 'Order not releasable',
    detail: 'The order is not yet in a state where payout can proceed.',
  },
  manual_review_required: {
    label: 'Review required',
    detail: 'An admin must review this payout before it can continue.',
  },
  payout_not_found: {
    label: 'Payout not found',
    detail: 'The payout record could not be located.',
  },
  payout_cancelled: {
    label: 'Payout cancelled',
    detail: 'The payout was cancelled and will not be processed.',
  },
};

const FAILURE_REASON_ALIASES: Array<{ match: RegExp; code: ProviderFailureReasonCode }> = [
  { match: /timeout|timed\s*out|took\s*too\s*long/i, code: 'provider_timeout' },
  { match: /unavailable|down|unreachable|cannot\s*reach|could\s*not\s*be\s*reached/i, code: 'provider_unavailable' },
  { match: /rate\s*limit|too\s*many\s*requests|throttl/i, code: 'provider_rate_limited' },
  { match: /submission\s*failed|provider\s*error|rejected|failed\s*during\s*submission/i, code: 'provider_execution_failed' },
  { match: /destination.*not.*verified|verification.*pending|account.*not.*verified|destinat.*verification/i, code: 'destination_not_verified' },
  { match: /destination.*incomplete|missing.*destination|account.*details.*missing|incomplete.*destination/i, code: 'destination_incomplete' },
  { match: /order.*not.*releasable|not.*ready.*for.*payout|release.*blocked/i, code: 'order_not_releasable' },
  { match: /manual\s*review|admin\s*review|review\s*required/i, code: 'manual_review_required' },
  { match: /not\s*found|missing\s*payout/i, code: 'payout_not_found' },
  { match: /cancelled|canceled/i, code: 'payout_cancelled' },
];

function normalizeReasonCode(value?: string | null): ProviderFailureReasonCode | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized in FAILURE_REASON_META) return normalized as ProviderFailureReasonCode;

  for (const alias of FAILURE_REASON_ALIASES) {
    if (alias.match.test(normalized)) return alias.code;
  }

  return null;
}

export function getSellerPayoutLaunchStatus(input: SellerPayoutSignalInput): SellerPayoutLaunchStatus {
  const status = String(input.status ?? '').toLowerCase();
  const destinationStatus = String(input.destinationStatus ?? '').toLowerCase();

  if (destinationStatus === 'failed' || input.verificationBlockers?.length) {
    return 'needs_destination_update';
  }

  if (status === 'failed') return 'needs_destination_update';
  if (status === 'held') return 'held';
  if (status === 'paid') return 'paid';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'pending_settlement') return 'pending_settlement';
  if (status === 'ready_for_payout') return 'ready_for_payout';
  if (status === 'processing') return 'sent_to_paychangu';
  if (status === 'pending') return 'provider_pending';
  if (status === 'queued' || input.manualReviewPending) return 'queued_for_admin_review';
  return 'eligible';
}

export function getSellerPayoutLaunchStatusMeta(input: SellerPayoutSignalInput): SellerPayoutLaunchStatusMeta {
  return LAUNCH_STATUS_META[getSellerPayoutLaunchStatus(input)];
}

export function getSellerPayoutStatusLabel(status: string): string {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'queued') return 'Queued for admin review';
  if (normalized === 'processing') return 'Sent to provider';
  if (normalized === 'pending') return 'Provider pending';
  if (normalized === 'failed') return 'Needs destination update';
  return getSellerPayoutLaunchStatusMeta({ status: normalized || 'eligible' }).label;
}

export function getSellerPayoutStatusDetail(status: string): string {
  return getSellerPayoutLaunchStatusMeta({ status }).detail;
}

export function getSellerPayoutFailureMeta(reasonCode?: string | null): SellerPayoutFailureMeta | null {
  const normalized = normalizeReasonCode(reasonCode);
  if (!normalized) return null;
  return FAILURE_REASON_META[normalized];
}

export function sellerOperationalSignals(input: SellerPayoutSignalInput): string[] {
  const messages: string[] = [];
  const destinationStatus = String(input.destinationStatus ?? '').toLowerCase();
  const launchStatus = getSellerPayoutLaunchStatusMeta(input);
  const failureMeta = getSellerPayoutFailureMeta(input.failureReasonCode);

  messages.push(launchStatus.label);

  if (failureMeta) {
    messages.push(failureMeta.label);
  }
  if (destinationStatus && destinationStatus !== 'verified') {
    messages.push(destinationStatus === 'failed' ? 'Needs destination update' : 'Destination pending verification');
  }
  if (input.status === 'held') {
    messages.push('Payout held');
  }
  if (input.manualReviewPending) {
    messages.push('Awaiting admin review');
  }
  if (input.status === 'failed') {
    messages.push('Payout failed');
  }
  if (input.retryAllowed === false && input.status === 'failed') {
    messages.push('Retry unavailable');
  }
  if (Array.isArray(input.verificationBlockers) && input.verificationBlockers.length > 0) {
    messages.push('Destination verification blocked');
    messages.push(...input.verificationBlockers);
  }

  return Array.from(new Set(messages));
}

export function getVisibleAdminActions(isAdmin: boolean): Array<'retry' | 'hold' | 'mark_paid' | 'mark_failed' | 'cancel'> {
  if (!isAdmin) return [];
  return ['retry', 'mark_paid', 'hold', 'mark_failed', 'cancel'];
}
