import { randomUUID } from 'node:crypto';

export interface PayChanguDirectCardConfig {
  enabled?: boolean;
  pciDssApproved?: boolean;
  paychanguSecretKey?: string;
  paychanguBaseUrl?: string;
  /** Exact return hosts controlled by the calling application; can also be set via PAYCHANGU_DIRECT_CARD_RETURN_HOSTS. */
  allowedRedirectHosts?: string[];
  fetcher?: typeof fetch;
}

export interface PayChanguDirectCardInput {
  /** Server-calculated order total; never take this from card-form input. */
  amount: number;
  currency: 'MWK' | 'USD';
  email: string;
  /** A Platform-owned HTTPS return URL. */
  redirectUrl: string;
  /** Persist this ID with the pending payment before the provider request. */
  chargeId: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
  cardholderName: string;
}

export type PayChanguDirectCardInitiation = {
  chargeId: string;
  status: 'pending_verification' | 'requires_action';
  requires3dsAuth: boolean;
  threeDsAuthUrl?: string;
  providerOrderReference?: string;
};

export interface PayChanguDirectCardVerification {
  chargeId: string;
  verified: boolean;
  status: 'paid' | 'pending' | 'failed' | 'reversed' | 'unknown';
  amount?: number;
  currency?: string;
  failureReason?: string;
}

type JsonRecord = Record<string, unknown>;

const SUCCESS_STATUSES = new Set(['success', 'successful', 'succeeded', 'completed', 'paid', 'captured', 'processed', 'approved']);
const PENDING_STATUSES = new Set(['pending', 'queued', 'initiated', 'processing', 'authorizing']);
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'declined', 'expired', 'authentication_failed']);
const REVERSED_STATUSES = new Set(['reversed', 'refunded', 'chargeback', 'charged_back']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnabledFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function assertDirectCardAllowed(config: PayChanguDirectCardConfig): void {
  const enabled = config.enabled ?? isEnabledFlag(process.env.PAYCHANGU_DIRECT_CARD_ENABLED);
  const pciDssApproved = config.pciDssApproved ?? isEnabledFlag(process.env.PAYCHANGU_DIRECT_CARD_PCI_APPROVED);

  if (!enabled) {
    throw new Error('PayChangu Direct Card Charge is disabled. Set PAYCHANGU_DIRECT_CARD_ENABLED only for an approved integration.');
  }
  if (!pciDssApproved) {
    throw new Error('PayChangu Direct Card Charge requires PCI DSS approval and explicit account activation.');
  }
  if (!(config.paychanguSecretKey ?? process.env.PAYCHANGU_SECRET_KEY)?.trim()) {
    throw new Error('Missing server-side PAYCHANGU_SECRET_KEY.');
  }
}

function resolveBaseUrl(config: PayChanguDirectCardConfig): string {
  const value = (config.paychanguBaseUrl ?? process.env.PAYCHANGU_BASE_URL ?? 'https://api.paychangu.com').trim();
  const normalized = value.replace(/\/+$/, '');
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('PayChangu base URL must use HTTPS.');
  }
  return normalized;
}

function validateChargeId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    throw new Error('Invalid Direct Card Charge identifier.');
  }
  return id;
}

function validateRedirectUrl(value: string, allowedHosts: string[]): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Direct Card Charge redirect URL must use HTTPS and must not include credentials.');
  }
  const hostname = url.hostname.toLowerCase();
  const isAllowed = allowedHosts.some((allowedHost) => {
    const normalized = allowedHost.trim().toLowerCase();
    return normalized.length > 0 && hostname === normalized;
  });
  if (!allowedHosts.length || !isAllowed) {
    throw new Error('Direct Card Charge redirect URL host is not in the application allowlist.');
  }
  return url.toString();
}

function validateCardInput(input: PayChanguDirectCardInput): {
  card_number: string;
  expiry: string;
  cvv: string;
  cardholder_name: string;
} {
  const cardNumber = input.cardNumber.replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(cardNumber)) {
    throw new Error('Invalid card number format.');
  }

  const expiry = input.expiry.trim();
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
    throw new Error('Card expiry must use MM/YY format.');
  }

  if (!/^\d{3,4}$/.test(input.cvv.trim())) {
    throw new Error('Invalid card security code format.');
  }

  const cardholderName = input.cardholderName.trim();
  if (cardholderName.length < 2 || cardholderName.length > 100) {
    throw new Error('Invalid cardholder name.');
  }

  return {
    card_number: cardNumber,
    expiry,
    cvv: input.cvv.trim(),
    cardholder_name: cardholderName,
  };
}

/** Validate raw card fields without retaining them; never log the input. */
export function validatePayChanguDirectCardFields(input: Pick<PayChanguDirectCardInput, "cardNumber" | "expiry" | "cvv" | "cardholderName">): void {
  validateCardInput({
    amount: 1,
    currency: "MWK",
    email: "validation@example.com",
    redirectUrl: "https://example.com/return",
    chargeId: "validation-only",
    cardNumber: input.cardNumber,
    expiry: input.expiry,
    cvv: input.cvv,
    cardholderName: input.cardholderName,
  });
}

function parseAmount(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

function normalizeStatus(value: unknown): PayChanguDirectCardVerification['status'] {
  const status = String(value ?? '').trim().toLowerCase();
  if (SUCCESS_STATUSES.has(status)) return 'paid';
  if (PENDING_STATUSES.has(status)) return 'pending';
  if (FAILED_STATUSES.has(status)) return 'failed';
  if (REVERSED_STATUSES.has(status)) return 'reversed';
  return 'unknown';
}

async function parseJsonResponse(response: Response): Promise<JsonRecord> {
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) return value;
  } catch {
    // Do not surface provider response bodies; they may contain sensitive values.
  }
  throw new Error('PayChangu returned an invalid JSON response (HTTP ' + response.status + ').');
}

/** Generate a unique charge ID once and persist it before calling PayChangu. */
export function createPayChanguDirectCardChargeId(): string {
  return 'BM-CARD-' + randomUUID().replace(/-/g, '');
}

/**
 * Initiate a direct card charge. This function never logs or persists PAN/CVV.
 * Callers must persist chargeId and a pending payment record before invoking it.
 */
export async function initiatePayChanguDirectCardCharge(
  input: PayChanguDirectCardInput,
  config: PayChanguDirectCardConfig = {},
): Promise<PayChanguDirectCardInitiation> {
  assertDirectCardAllowed(config);

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    throw new Error('Direct Card Charge amount must be positive with at most two decimal places.');
  }
  if (input.currency !== 'MWK' && input.currency !== 'USD') {
    throw new Error('Unsupported Direct Card Charge currency.');
  }
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) {
    throw new Error('A valid customer email is required for Direct Card Charge.');
  }

  const chargeId = validateChargeId(input.chargeId);
  const allowedRedirectHosts = config.allowedRedirectHosts ?? String(process.env.PAYCHANGU_DIRECT_CARD_RETURN_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  const redirectUrl = validateRedirectUrl(input.redirectUrl, allowedRedirectHosts);
  const card = validateCardInput(input);
  const secret = (config.paychanguSecretKey ?? process.env.PAYCHANGU_SECRET_KEY ?? '').trim();
  const baseUrl = resolveBaseUrl(config);
  const fetcher = config.fetcher ?? fetch;

  const response = await fetcher(baseUrl + '/charge-card/payments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + secret,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...card,
      amount: amount.toFixed(2),
      currency: input.currency,
      email: input.email.trim(),
      charge_id: chargeId,
      redirect_url: redirectUrl,
    }),
  });

  const body = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error('PayChangu Direct Card Charge initiation failed (HTTP ' + response.status + ').');
  }

  const data = isRecord(body.data) ? body.data : body;
  const requires3dsAuth = data.requires_3ds_auth === true || body.requires_3ds_auth === true;
  const authUrlValue = data['3ds_auth_link'] ?? body['3ds_auth_link'];
  const providerOrderReference = data.orderReference ?? body.orderReference;
  const status = String(data.status ?? body.status ?? '').trim().toLowerCase();
  const accepted = body.success === true || data.success === true || status === 'success' || requires3dsAuth;

  if (!accepted) {
    throw new Error('PayChangu did not accept the Direct Card Charge request.');
  }

  let threeDsAuthUrl: string | undefined;
  if (requires3dsAuth) {
    if (typeof authUrlValue !== 'string' || !authUrlValue.trim()) {
      throw new Error('PayChangu requested 3-D Secure authentication but omitted the authentication URL.');
    }
    const authUrl = new URL(authUrlValue);
    if (authUrl.protocol !== 'https:' || !(authUrl.hostname === 'paychangu.com' || authUrl.hostname.endsWith('.paychangu.com'))) {
      throw new Error('PayChangu returned an invalid 3-D Secure authentication URL.');
    }
    threeDsAuthUrl = authUrl.toString();
  }

  // Remain pending until server-side charge verification succeeds.
  return {
    chargeId,
    status: requires3dsAuth ? 'requires_action' : 'pending_verification',
    requires3dsAuth,
    ...(threeDsAuthUrl ? { threeDsAuthUrl } : {}),
    ...(typeof providerOrderReference === 'string' && providerOrderReference.trim()
      ? { providerOrderReference: providerOrderReference.trim() }
      : {}),
  };
}

/**
 * Verify a charge before fulfilment. Amount, currency, and charge identity are checked
 * against server-side order data; browser-return parameters are never proof of payment.
 */
export async function verifyPayChanguDirectCardCharge(
  input: { chargeId: string; expectedAmount: number; expectedCurrency: 'MWK' | 'USD' },
  config: PayChanguDirectCardConfig = {},
): Promise<PayChanguDirectCardVerification> {
  assertDirectCardAllowed(config);

  if (!Number.isFinite(input.expectedAmount) || input.expectedAmount <= 0) {
    throw new Error('Invalid expected amount for Direct Card Charge verification.');
  }

  const chargeId = validateChargeId(input.chargeId);
  const secret = (config.paychanguSecretKey ?? process.env.PAYCHANGU_SECRET_KEY ?? '').trim();
  const baseUrl = resolveBaseUrl(config);
  const fetcher = config.fetcher ?? fetch;
  const response = await fetcher(baseUrl + '/charge-card/verify/' + encodeURIComponent(chargeId), {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + secret,
      Accept: 'application/json',
    },
  });

  const body = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error('PayChangu Direct Card Charge verification failed (HTTP ' + response.status + ').');
  }

  const data = isRecord(body.data) ? body.data : body;
  const transaction = isRecord(data.transaction) ? data.transaction : data;
  const returnedChargeIdValue = transaction.charge_id ?? transaction.chargeId ?? data.charge_id ?? body.charge_id;
  const returnedChargeId = typeof returnedChargeIdValue === 'string' ? returnedChargeIdValue.trim() : '';
  const status = normalizeStatus(transaction.status ?? data.status ?? body.status ?? (body.success === true ? 'success' : undefined));
  const amount = parseAmount(transaction.amount ?? data.amount ?? body.amount);
  const currencyValue = transaction.currency ?? data.currency ?? body.currency;
  const currency = typeof currencyValue === 'string' ? currencyValue.trim().toUpperCase() : undefined;

  if (returnedChargeId && returnedChargeId !== chargeId) {
    return { chargeId, verified: false, status, amount, currency, failureReason: 'Verified charge identifier does not match the requested charge.' };
  }
  if (status !== 'paid') {
    return { chargeId, verified: false, status, amount, currency, failureReason: 'PayChangu has not confirmed a successful card charge.' };
  }
  if (amount === undefined || amount !== input.expectedAmount) {
    return { chargeId, verified: false, status, amount, currency, failureReason: 'Verified amount does not exactly match the expected order total.' };
  }
  if (currency !== input.expectedCurrency) {
    return { chargeId, verified: false, status, amount, currency, failureReason: 'Verified currency does not match the expected order currency.' };
  }

  return { chargeId, verified: true, status: 'paid', amount, currency };
}
