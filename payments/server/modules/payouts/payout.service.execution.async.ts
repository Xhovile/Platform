import './payout.schema.js';
import { query } from '../../postgres.js';
import {
  executePayChanguPayout,
  getPayChanguPayoutBalance,
  type PayChanguPayoutExecutionResult,
} from './paychangu.payout.js';
import { PAYOUT_POLICY, isRetryableFailureCode } from './payout.policy.js';
import {
  classifyProviderFailureFromError,
  decryptSensitiveValue,
  exactProviderErrorMessage,
  providerFailureReason,
  isProviderHoldFailure,
  type ExecutePayoutInput,
  type PayoutAttemptRecord,
  type PayoutNextAction,
  type PayoutRecord,
} from './payout.shared.js';
import {
  addPayoutEvent,
  gatePayoutForSubmission,
  getPayout,
  recordAttempt,
  reserveRetryAttempt,
  updateDestinationAccount,
  updatePayoutStatus,
} from './payout.execution-repository.js';

type ExecutionDestination = {
  destinationType: string | null;
  providerRefId: string | null;
  providerName: string | null;
  accountName: string | null;
  verificationStatus: string;
  isActive: boolean;
  accountNumberEncrypted: string | null;
  mobileEncrypted: string | null;
};

export type PayoutExecutionGate = {
  allowed: boolean;
  reasonCode?: string;
  reason?: string;
  sellerId?: string;
  amount?: number;
  currency?: string;
  provider?: string;
  destinationType?: 'bank' | 'mobile_money';
  destinationValue?: string | null;
  destinationProviderRefId?: string | null;
  destinationProviderName?: string | null;
  destinationAccountName?: string | null;
  currentFailureReason?: string | null;
  currentProviderChargeId?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function hydrateDestination(row: Record<string, unknown>): ExecutionDestination {
  return {
    destinationType: normalizeText(row.destination_type ?? row.destinationType),
    providerRefId: normalizeText(row.provider_ref_id ?? row.destination_provider_ref_id ?? row.destinationProviderRefId),
    providerName: normalizeText(row.provider_name ?? row.destination_provider_name ?? row.destinationProviderName),
    accountName: normalizeText(row.account_name ?? row.destination_account_name ?? row.destinationAccountName),
    verificationStatus: normalizeText(row.verification_status ?? row.destination_verification_status) ?? 'missing',
    isActive: Number(row.is_active ?? row.destination_active ?? 0) === 1,
    accountNumberEncrypted: normalizeText(row.account_number_encrypted ?? row.destination_account_number_encrypted),
    mobileEncrypted: normalizeText(row.mobile_encrypted ?? row.destination_mobile_encrypted),
  };
}

export async function gateForSubmissionAsync(payoutId: string): Promise<PayoutExecutionGate> {
  const { row, fallbackDestination } = await gatePayoutForSubmission(payoutId);
  if (!row) return { allowed: false, reasonCode: 'payout_not_found', reason: 'Payout not found' };

  const payoutStatus = String(row.status ?? '').toLowerCase();
  if (payoutStatus === 'cancelled') return { allowed: false, reasonCode: 'payout_cancelled', reason: 'Payout is cancelled' };
  if (payoutStatus === 'paid') return { allowed: false, reasonCode: 'manual_review_required', reason: 'Payout is already paid' };
  if (!['eligible', 'ready_for_payout', 'queued', 'failed', 'pending', 'held'].includes(payoutStatus)) {
    return { allowed: false, reasonCode: 'manual_review_required', reason: `Payout in ${payoutStatus} cannot be submitted` };
  }

  const attempts = Number(row.attempt_count ?? 0);
  if (attempts >= PAYOUT_POLICY.maxRetryCount) {
    return { allowed: false, reasonCode: 'manual_review_required', reason: `Retry limit reached (${PAYOUT_POLICY.maxRetryCount})` };
  }
  if (payoutStatus === 'failed' && !isRetryableFailureCode((row.failure_reason as string | null | undefined) ?? null)) {
    return { allowed: false, reasonCode: 'manual_review_required', reason: 'Failed payout is not retryable' };
  }

  const amount = Number(row.amount ?? 0);
  if (!Number.isFinite(amount) || amount < PAYOUT_POLICY.minimumPayoutAmount) {
    return { allowed: false, reasonCode: 'manual_review_required', reason: `Payout amount must be at least ${PAYOUT_POLICY.minimumPayoutAmount}` };
  }

  const orderStatus = String(row.order_status ?? '').toLowerCase();
  if (orderStatus === 'disputed') return { allowed: false, reasonCode: 'order_disputed', reason: 'Order is disputed' };
  if (!['paid', 'in_escrow', 'fulfilled'].includes(orderStatus)) {
    return { allowed: false, reasonCode: 'order_not_releasable', reason: 'Order is not in a releasable state' };
  }

  const escrowState = String(row.escrow_state ?? '').toLowerCase();
  if (escrowState && escrowState !== 'released') {
    return { allowed: false, reasonCode: 'order_not_releasable', reason: 'Escrow must be released before payout submission' };
  }
  if (Number(row.seller_suspended ?? 0) === 1) {
    return { allowed: false, reasonCode: 'seller_suspended', reason: 'Seller is suspended' };
  }

  let destination: ExecutionDestination | null = null;
  const current = hydrateDestination(row);
  if (current.destinationType && current.verificationStatus === 'verified' && current.isActive) {
    destination = current;
  } else if (fallbackDestination) {
    destination = hydrateDestination(fallbackDestination);
    const existingDestinationId = normalizeText(row.destination_account_id);
    if (fallbackDestination.id && fallbackDestination.id !== existingDestinationId) {
      await updateDestinationAccount(payoutId, String(fallbackDestination.id));
    }
  }

  if (!destination?.destinationType) {
    return { allowed: false, reasonCode: 'destination_not_verified', reason: 'No payout destination selected' };
  }
  if (!destination.isActive) {
    return { allowed: false, reasonCode: 'destination_disabled', reason: 'Destination is disabled' };
  }

  const verificationStatus = destination.verificationStatus.toLowerCase();
  if (verificationStatus === 'failed') return { allowed: false, reasonCode: 'destination_failed', reason: 'Destination verification failed' };
  if (verificationStatus === 'disabled') return { allowed: false, reasonCode: 'destination_disabled', reason: 'Destination is disabled' };
  if (verificationStatus !== 'verified') return { allowed: false, reasonCode: 'destination_not_verified', reason: 'Destination is pending verification' };

  const destinationValue = (
    destination.destinationType === 'bank'
      ? decryptSensitiveValue(destination.accountNumberEncrypted)
      : decryptSensitiveValue(destination.mobileEncrypted)
  ) ?? null;
  if (!destinationValue) return { allowed: false, reasonCode: 'destination_incomplete', reason: 'Destination details are incomplete' };

  const destinationProviderRefId = (destination.providerRefId ?? '').trim();
  if (!destinationProviderRefId) return { allowed: false, reasonCode: 'destination_incomplete', reason: 'Destination routing details are incomplete' };

  return {
    allowed: true,
    sellerId: String(row.seller_id ?? ''),
    amount,
    currency: String(row.currency ?? 'MWK'),
    provider: String(row.provider ?? 'paychangu'),
    destinationType: destination.destinationType as 'bank' | 'mobile_money',
    destinationValue,
    destinationProviderRefId,
    destinationProviderName: destination.providerName,
    destinationAccountName: destination.accountName,
    currentFailureReason: (row.failure_reason as string | null) ?? null,
    currentProviderChargeId: (row.provider_charge_id as string | null) ?? null,
  };
}

async function holdPayoutForReviewAsync(
  input: {
    payoutId: string;
    sellerId: string;
    reasonCode: string;
    reason: string;
    payload?: Record<string, unknown> | null;
    statusExtras?: Record<string, unknown>;
  },
  actor: { actorType: 'admin' | 'system'; actorId?: string | null },
): Promise<PayoutRecord | undefined> {
  const payout = await updatePayoutStatus(input.payoutId, 'held', {
    provider: 'paychangu',
    providerStatus: 'held',
    failureReason: input.reasonCode,
    manualReviewReason: input.reason,
    ...(input.statusExtras ?? {}),
  });
  await addPayoutEvent({
    payoutId: input.payoutId,
    sellerId: input.sellerId,
    eventType: 'payout_held',
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    note: input.reason,
    payload: { reasonCode: input.reasonCode, ...(input.payload ?? {}) },
  });
  return payout;
}

export async function executePayoutFlow(
  _repository: unknown,
  input: ExecutePayoutInput,
): Promise<{
  payout: PayoutRecord | undefined;
  attempt: PayoutAttemptRecord | null;
  execution: PayChanguPayoutExecutionResult | null;
  reasonCode: string | null;
  reason: string;
  nextAction: PayoutNextAction;
}> {
  const actor = { actorType: input.actorType ?? 'system', actorId: input.actorId ?? null };
  const gate = await gateForSubmissionAsync(input.payoutId);

  if (!gate.allowed || !gate.sellerId || !gate.amount || !gate.currency || !gate.provider) {
    const payout = gate.sellerId
      ? await holdPayoutForReviewAsync({
          payoutId: input.payoutId,
          sellerId: gate.sellerId,
          reasonCode: gate.reasonCode ?? 'manual_review_required',
          reason: gate.reason ?? 'Payout failed eligibility gate',
        }, actor)
      : undefined;
    return {
      payout,
      attempt: null,
      execution: null,
      reasonCode: gate.reasonCode ?? 'manual_review_required',
      reason: gate.reason ?? 'Payout failed eligibility gate',
      nextAction: (payout ? 'manual_review' : 'none') as PayoutNextAction,
    };
  }

  await updatePayoutStatus(input.payoutId, 'queued', {
    provider: gate.provider,
    providerStatus: 'queued',
    approvedBy: actor.actorType === 'admin' ? actor.actorId ?? null : null,
  });
  await addPayoutEvent({
    payoutId: input.payoutId,
    sellerId: gate.sellerId,
    eventType: 'payout_queued',
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    note: 'Payout queued for provider submission',
  });

  try {
    await getPayChanguPayoutBalance(gate.currency);
  } catch (error) {
    const failureReason = classifyProviderFailureFromError(error) ?? 'provider_unavailable';
    const reason = providerFailureReason(failureReason);
    const payout = await holdPayoutForReviewAsync({
      payoutId: input.payoutId,
      sellerId: gate.sellerId,
      reasonCode: failureReason,
      reason,
      payload: {
        stage: 'balance_check',
        error: error instanceof Error ? error.message : String(error),
        reasonCode: failureReason,
      },
    }, actor);
    return { payout, attempt: null, execution: null, reasonCode: failureReason, reason, nextAction: 'manual_review' as PayoutNextAction };
  }

  const reservedAttempt = await reserveRetryAttempt({
    payoutId: input.payoutId,
    provider: gate.provider,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
  });
  const attemptNo = reservedAttempt.attemptNo;

  if (attemptNo > 1 || gate.currentFailureReason) {
    await addPayoutEvent({
      payoutId: input.payoutId,
      sellerId: gate.sellerId,
      eventType: 'payout_retried',
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      note: `Retry accepted for attempt ${attemptNo}`,
      payload: {
        payoutId: input.payoutId,
        sellerId: gate.sellerId,
        actorType: actor.actorType,
        actorId: actor.actorId ?? null,
        attemptNo,
        previousFailureReason: gate.currentFailureReason ?? null,
        retryReason: actor.actorType === 'admin' ? 'admin_requested_retry' : 'system_requested_retry',
        providerChargeId: reservedAttempt.providerChargeId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  const execution = await executePayChanguPayout({
    payoutId: input.payoutId,
    sellerId: gate.sellerId,
    amount: gate.amount,
    currency: gate.currency,
    providerName: gate.provider,
    destinationReference: gate.destinationValue ?? input.destinationReference ?? input.payoutId,
    attemptNo,
    destinationType: gate.destinationType,
    mobile: gate.destinationType === 'mobile_money' ? gate.destinationValue ?? undefined : undefined,
    bankAccountNumber: gate.destinationType === 'bank' ? gate.destinationValue ?? undefined : undefined,
    mobileMoneyOperatorRefId: gate.destinationProviderRefId ?? undefined,
    bankUuid: gate.destinationProviderRefId ?? undefined,
    bankAccountName: gate.destinationAccountName ?? undefined,
  });

  await recordAttempt(reservedAttempt.id, execution);

  const providerReference = String(
    execution.providerReference ?? reservedAttempt.providerChargeId ?? execution.providerChargeId ?? '',
  );

  const attempt: PayoutAttemptRecord = {
    id: reservedAttempt.id,
    payoutId: input.payoutId,
    provider: execution.provider,
    providerChargeId: execution.providerChargeId,
    providerReference,
    providerTransactionId: execution.providerTransactionId,
    status: execution.status,
    attemptNo: execution.attemptNo,
    rawResponse: execution.rawResponse,
    createdAt: reservedAttempt.createdAt,
  };

  if (execution.status === 'failed' && isProviderHoldFailure(execution.failureClass)) {
    const failureClass: NonNullable<typeof execution.failureClass> = execution.failureClass ?? 'provider_unavailable';
    const exactMessage = exactProviderErrorMessage(execution.rawResponse);
    const reason = providerFailureReason(failureClass, failureClass === 'provider_unavailable' ? null : exactMessage);
    const payout = await holdPayoutForReviewAsync({
      payoutId: input.payoutId,
      sellerId: gate.sellerId,
      reasonCode: failureClass,
      reason,
      payload: { attemptNo, providerChargeId: execution.providerChargeId, providerStatus: execution.status },
      statusExtras: {
        provider: execution.provider,
        providerChargeId: execution.providerChargeId,
        providerReference,
        providerTransactionId: execution.providerTransactionId,
        lastAttemptId: attempt.id,
        rawResponse: execution.rawResponse,
        sentAt: execution.processedAt,
        failedAt: execution.processedAt,
      },
    }, actor);

    await addPayoutEvent({
      payoutId: input.payoutId,
      sellerId: gate.sellerId,
      eventType: 'payout_retry_blocked',
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      note: reason,
      payload: { attemptNo, providerChargeId: execution.providerChargeId, reasonCode: failureClass },
    });

    return { payout, attempt, execution, reasonCode: failureClass, reason, nextAction: 'retry_blocked' as PayoutNextAction };
  }

  const payout = await updatePayoutStatus(input.payoutId, execution.status, {
    lastAttemptId: attempt.id,
    rawResponse: execution.rawResponse,
    failureReason: execution.status === 'failed' ? execution.failureClass ?? 'provider_execution_failed' : null,
    providerTransactionId: execution.providerTransactionId,
    provider: execution.provider,
    providerChargeId: execution.providerChargeId,
    providerReference,
    providerStatus: execution.status,
    approvedBy: actor.actorType === 'admin' ? actor.actorId ?? null : null,
    sentAt: execution.processedAt,
    paidAt: execution.status === 'paid' ? execution.processedAt : null,
    failedAt: execution.status === 'failed' ? execution.processedAt : null,
  });

  await addPayoutEvent({
    payoutId: input.payoutId,
    sellerId: gate.sellerId,
    eventType: execution.status === 'failed' ? 'payout_failed' : execution.status === 'paid' ? 'payout_paid' : 'payout_sent',
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    note: execution.status === 'failed'
      ? `Provider attempt ${attemptNo} failed`
      : execution.status === 'paid'
        ? `Provider attempt ${attemptNo} paid`
        : `Provider attempt ${attemptNo} sent`,
    payload: execution.rawResponse as Record<string, unknown> | undefined,
  });

  return {
    payout,
    attempt,
    execution,
    reasonCode: execution.status === 'failed' ? execution.failureClass ?? 'provider_execution_failed' : null,
    reason: execution.status === 'failed'
      ? execution.failureClass ? providerFailureReason(execution.failureClass) : 'Provider reported payout failure.'
      : execution.status === 'paid' ? 'Payout paid successfully.' : 'Payout submitted to provider.',
    nextAction: execution.status === 'paid' ? 'none' : execution.status === 'failed' ? 'manual_review' : 'awaiting_provider',
  };
}

export async function getProviderBalance(currency = 'MWK') {
  return getPayChanguPayoutBalance(currency);
}
