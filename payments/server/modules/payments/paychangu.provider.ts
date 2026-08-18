import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type {
  CreatePaymentRequest,
  PaymentResult,
  PaymentVerificationResult,
  RefundRequest,
  RefundResult,
  WebhookVerificationResult,
} from '../../../src/modules/payments/types.js';
import type { PaymentMethod } from '../../../src/shared/types/payment.js';

const ACCEPTED_PAYCHANGU_SIGNATURE_HEADERS = ['x-paychangu-signature', 'signature'] as const;
const REFUND_UNAVAILABLE_MESSAGE = 'Refunds are not available yet for this payment provider';

export const PAYCHANGU_SUCCESS_STATUSES = new Set([
  'success',
  'successful',
  'succeeded',
  'completed',
  'paid',
  'captured',
  'processed',
  'approved',
]);

export const PAYCHANGU_ACCEPTED_EVENT_TYPES = new Set([
  'payment.success',
  'payment.successful',
  'payment.completed',
  'charge.success',
  'charge.completed',
  'api.charge.payment',
  'transaction.success',
]);

export interface PayChanguConfig {
  paychanguSecretKey?: string;
  paychanguWebhookSecret?: string;
  paychanguBaseUrl?: string;
  paychanguCallbackUrl?: string;
  paychanguReturnUrl?: string;
}

interface PayChanguPaymentSessionData {
  tx_ref?: string;
  txRef?: string;
  reference?: string;
  id?: string;
  status?: string;
}

interface PayChanguPaymentInitData extends PayChanguPaymentSessionData {
  checkout_url?: string;
  checkoutUrl?: string;
  data?: PayChanguPaymentSessionData;
}

interface PayChanguPaymentInitResponse {
  status?: string;
  message?: string;
  data?: PayChanguPaymentInitData;
}

function getBaseUrl(config: PayChanguConfig): string {
  return config.paychanguBaseUrl?.replace(/\/$/, '') ?? 'https://api.paychangu.com';
}

function normalizeTxRef(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function toISODate(): string {
  return new Date().toISOString();
}

function buildPayChanguJsonHeaders(config: PayChanguConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.paychanguSecretKey) {
    headers.Authorization = `Bearer ${config.paychanguSecretKey}`;
  }

  return headers;
}

function serializeMeta(metadata: Record<string, unknown> | undefined): Array<{ key: string; value: string }> {
  if (!metadata) return [];

  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? JSON.stringify(value) : String(value),
    }));
}

function hasAtMostTwoDecimals(value: number): boolean {
  const scaled = value * 100;
  return Number.isInteger(scaled);
}

function formatProviderErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatProviderErrorMessage(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (isPlainRecord(value)) {
    const directMessage = formatProviderErrorMessage(value.message ?? value.error ?? value.detail ?? value.reason);
    if (directMessage) return directMessage;

    const parts = Object.entries(value)
      .map(([key, nested]) => {
        const nestedMessage = formatProviderErrorMessage(nested);
        return nestedMessage ? `${key}: ${nestedMessage}` : null;
      })
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join('; ') : null;
  }

  return null;
}

function buildPayChanguFailureMessage(response: PayChanguPaymentInitResponse): string {
  const providerMessage = formatProviderErrorMessage(
    response.message ?? (response as Record<string, unknown>).error ?? response.data,
  );

  return providerMessage || 'PayChangu payment initialization failed';
}

export type PayChanguPaymentStatus = 'pending' | 'paid' | 'failed' | 'reversed' | 'unknown';

const PAYCHANGU_PENDING_STATUSES = new Set(['pending', 'queued', 'initiated', 'processing']);
const PAYCHANGU_FAILED_STATUSES = new Set([
  'failed',
  'cancelled',
  'canceled',
  'declined',
  'expired',
]);
const PAYCHANGU_REVERSED_STATUSES = new Set([
  'reversed',
  'refunded',
  'chargeback',
  'charged_back',
]);

function normalizeProviderStatus(rawStatus: unknown): {
  normalized: PayChanguPaymentStatus;
  providerStatus: string;
} {
  const providerStatus = String(rawStatus ?? '').trim().toLowerCase();

  if (PAYCHANGU_PENDING_STATUSES.has(providerStatus)) {
    return { normalized: 'pending', providerStatus };
  }

  if (PAYCHANGU_SUCCESS_STATUSES.has(providerStatus)) {
    return { normalized: 'paid', providerStatus };
  }

  if (PAYCHANGU_FAILED_STATUSES.has(providerStatus)) {
    return { normalized: 'failed', providerStatus };
  }

  if (PAYCHANGU_REVERSED_STATUSES.has(providerStatus)) {
    return { normalized: 'reversed', providerStatus };
  }

  return { normalized: 'unknown', providerStatus };
}

export function normalizePaychanguPaymentStatus(
  status: string | undefined,
): PayChanguPaymentStatus {
  return normalizeProviderStatus(status).normalized;
}

export function normalizePaychanguStatus(rawStatus: unknown): PayChanguPaymentStatus {
  return normalizeProviderStatus(rawStatus).normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortDeep(value[key]);
      return acc;
    }, {});
}

function stringifyStable(value: unknown): string {
  try {
    return JSON.stringify(sortDeep(value));
  } catch {
    return '';
  }
}

function parseWebhookPayload(
  payload: unknown,
): { rawPayload: string; parsedPayload: Record<string, unknown> | null } {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return {
        rawPayload: payload,
        parsedPayload: isPlainRecord(parsed) ? parsed : null,
      };
    } catch {
      return {
        rawPayload: payload,
        parsedPayload: null,
      };
    }
  }

  if (Buffer.isBuffer(payload)) {
    const rawPayload = payload.toString('utf8');
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      return {
        rawPayload,
        parsedPayload: isPlainRecord(parsed) ? parsed : null,
      };
    } catch {
      return {
        rawPayload,
        parsedPayload: null,
      };
    }
  }

  if (isPlainRecord(payload)) {
    return {
      rawPayload: stringifyStable(payload),
      parsedPayload: payload,
    };
  }

  return {
    rawPayload: stringifyStable(payload),
    parsedPayload: null,
  };
}

function signatureMatches(
  secret: string | undefined,
  payloads: string[],
  signature: string | undefined,
): boolean {
  if (!secret || !signature) return false;

  const normalizedSignature = signature.trim();
  const candidateSignatures = [
    normalizedSignature,
    normalizedSignature.replace(/^sha256=/i, ''),
  ];

  for (const payload of payloads) {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const expectedHex = Buffer.from(expected, 'hex');

    for (const candidate of candidateSignatures) {
      if (!candidate) continue;
      if (/^[a-fA-F0-9]+$/.test(candidate) && candidate.length % 2 === 0) {
        try {
          const candidateHex = Buffer.from(candidate.toLowerCase(), 'hex');
          if (
            candidateHex.length === expectedHex.length &&
            timingSafeEqual(expectedHex, candidateHex)
          ) {
            return true;
          }
        } catch {
          // continue with next candidate
        }
      }
    }
  }

  return false;
}

function buildWebhookPayloadCandidates(payload: unknown, parsedPayload: Record<string, unknown> | null): string[] {
  const candidates = new Set<string>();

  if (typeof payload === 'string') {
    candidates.add(payload);
  } else if (Buffer.isBuffer(payload)) {
    candidates.add(payload.toString('utf8'));
  }

  if (parsedPayload) {
    candidates.add(JSON.stringify(parsedPayload));
    candidates.add(stringifyStable(parsedPayload));
  }

  if (isPlainRecord(payload)) {
    candidates.add(JSON.stringify(payload));
    candidates.add(stringifyStable(payload));
  }

  return [...candidates].filter((candidate) => candidate.length > 0);
}

export const paychanguProvider = {
  key: 'paychangu' as const,

  capabilities: {
    supportsWebhookVerification: true,
    supportsRefunds: false,
    supportsPartialCapture: false,
    supportedMethods: ['card', 'bank_transfer', 'mobile_money'] as PaymentMethod[],
    currencies: ['MWK', 'USD'],
  },

  async createPayment(
    request: CreatePaymentRequest,
    config: PayChanguConfig = {},
  ): Promise<PaymentResult> {
    const baseUrl = getBaseUrl(config);
    const reference = `PAYCHANGU-${request.orderId}-${Date.now()}`;
    const txRef = normalizeTxRef(undefined, reference);
    const callbackUrl =
      config.paychanguCallbackUrl ||
      process.env.PAYCHANGU_CALLBACK_URL ||
      request.returnUrl;
    const returnUrl =
      request.returnUrl ||
      config.paychanguReturnUrl ||
      process.env.PAYCHANGU_RETURN_URL;

    if (!callbackUrl) {
      throw new Error('Missing required callback_url for PayChangu initiation');
    }
    if (!returnUrl) {
      throw new Error('Missing required return_url for PayChangu initiation');
    }

    const amountValue = Number(request.amount.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      throw new Error(`Invalid amount for PayChangu initiation: ${String(request.amount.amount)}`);
    }
    if (!hasAtMostTwoDecimals(amountValue)) {
      throw new Error(`Amount must have at most 2 decimal places: ${String(request.amount.amount)}`);
    }

    const [firstNameRaw, ...lastNameRaw] = String(request.customer.name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const firstName = firstNameRaw || undefined;
    const lastName = lastNameRaw.join(' ').trim() || undefined;

    const payload: Record<string, unknown> = {
      amount: amountValue.toFixed(2),
      currency: request.amount.currency,
      tx_ref: txRef,
      callback_url: callbackUrl,
      return_url: returnUrl,
      customization: {
        title: 'BuyMesho Checkout',
        description: `Payment for order ${request.orderId}`,
      },
      meta: serializeMeta(request.metadata),
    };

    if (request.customer.email) {
      payload.email = request.customer.email;
    }
    if (firstName) {
      payload.first_name = firstName;
    }
    if (lastName) {
      payload.last_name = lastName;
    }

    const response = await fetch(`${baseUrl}/payment`, {
      method: 'POST',
      headers: buildPayChanguJsonHeaders(config),
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as PayChanguPaymentInitResponse;

    if (!response.ok) {
      throw new Error(buildPayChanguFailureMessage(data));
    }

    const sessionData = data.data?.data ?? data.data;
    const checkoutUrl = data.data?.checkout_url ?? data.data?.checkoutUrl ?? null;
    const returnedTxRef = sessionData?.tx_ref ?? sessionData?.txRef;
    const providerReference = sessionData?.id ?? sessionData?.reference ?? null;

    return {
      id: randomUUID(),
      orderId: request.orderId,
      provider: 'paychangu',
      method: request.method,
      status: 'pending',
      amount: request.amount,
      reference: returnedTxRef ?? txRef,
      providerReference,
      checkoutUrl,
      paidAt: null,
      rawResponse: data as Record<string, unknown>,
      createdAt: toISODate(),
      updatedAt: toISODate(),
    };
  },

  async verifyPayment(
    txRef: string,
    config: PayChanguConfig = {},
  ): Promise<PaymentVerificationResult> {
    const baseUrl = getBaseUrl(config);

    const response = await fetch(
      `${baseUrl}/verify-payment/${encodeURIComponent(txRef)}`,
      {
        method: 'GET',
        headers: buildPayChanguJsonHeaders(config),
      },
    );

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(
        (data.message as string | undefined) ?? 'PayChangu verification failed',
      );
    }

    const payload = (data.data ?? data) as Record<string, unknown>;

    const amountValue =
      typeof payload.amount === 'number'
        ? payload.amount
        : typeof payload.amount === 'string'
          ? Number(payload.amount)
          : NaN;

    const amount = Number.isFinite(amountValue)
      ? { amount: amountValue, currency: String(payload.currency ?? 'MWK') }
      : undefined;

    const providerStatus = String(payload.status ?? '').trim().toLowerCase();
    const verified = isPaychanguSuccessStatus(providerStatus) && !!amount && amount.amount > 0;

    return {
      verified,
      provider: 'paychangu',
      txRef,
      reference: String(payload.tx_ref ?? payload.txRef ?? txRef),
      status: providerStatus || 'unknown',
      currency: String(payload.currency ?? 'MWK'),
      amount,
      checkoutUrl: null,
      rawResponse: data,
    };
  },

  async refund(_request: RefundRequest): Promise<RefundResult> {
    throw new Error(REFUND_UNAVAILABLE_MESSAGE);
  },

  async verifyWebhook(
    signature: string | undefined,
    payload: string | Record<string, unknown>,
    config: PayChanguConfig = {},
  ): Promise<WebhookVerificationResult> {
    const { rawPayload, parsedPayload } = parseWebhookPayload(payload);
    const payloadCandidates = buildWebhookPayloadCandidates(payload, parsedPayload);

    return {
      valid:
        parsedPayload !== null &&
        signatureMatches(config.paychanguWebhookSecret, [rawPayload, ...payloadCandidates], signature),
      provider: 'paychangu',
      eventType: parsedPayload
        ? String(parsedPayload.event_type ?? parsedPayload.event ?? '')
        : undefined,
      reference: parsedPayload
        ? String(parsedPayload.tx_ref ?? parsedPayload.reference ?? '')
        : undefined,
      signature,
      payload,
    };
  },

  async parseWebhook(payload: unknown): Promise<WebhookVerificationResult> {
    const { rawPayload, parsedPayload } = parseWebhookPayload(payload);
    return {
      valid: parsedPayload !== null,
      provider: 'paychangu',
      eventType: parsedPayload
        ? String(parsedPayload.event_type ?? parsedPayload.event ?? '')
        : undefined,
      reference: parsedPayload
        ? String(parsedPayload.tx_ref ?? parsedPayload.reference ?? '')
        : undefined,
      payload: parsedPayload ?? rawPayload,
    };
  },
};

export const paychanguWebhookSpec = {
  acceptedSignatureHeaders: ACCEPTED_PAYCHANGU_SIGNATURE_HEADERS,
  acceptedEventTypes: [...PAYCHANGU_ACCEPTED_EVENT_TYPES],
  successfulStatuses: [...PAYCHANGU_SUCCESS_STATUSES],
};

export function isAcceptedPaychanguEventType(eventType: string | undefined): boolean {
  if (!eventType) return false;
  return PAYCHANGU_ACCEPTED_EVENT_TYPES.has(eventType.trim().toLowerCase());
}

export function isPaychanguSuccessStatus(status: string | undefined): boolean {
  return normalizePaychanguPaymentStatus(status) === 'paid';
}
