import { randomUUID } from 'crypto';
import { buildPayChanguPayoutChargeId } from '../payments/paychangu.flow.js';
import { paychanguProvider } from '../payments/paychangu.provider.js';

export type PayChanguPayoutExecutionStatus =
  | 'queued'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'pending';

export type PayChanguPayoutDestinationType = 'mobile_money' | 'bank';

export interface ExecutePayChanguPayoutInput {
  payoutId: string;
  sellerId: string;
  amount: number;
  currency: string;
  providerName: string;
  destinationReference: string;
  attemptNo: number;
  destinationType?: PayChanguPayoutDestinationType;
  bankUuid?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  mobile?: string;
  mobileMoneyOperatorRefId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  transactionStatus?: 'failed' | 'successful';
}

export type PayChanguPayoutFailureClass =
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_rate_limited'
  | 'provider_rejected'
  | 'provider_authentication_error'
  | 'provider_configuration_error'
  | 'provider_conflict'
  | null;

export interface PayChanguPayoutExecutionResult {
  payoutId: string;
  provider: 'paychangu';
  providerChargeId: string;
  providerReference: string;
  providerTransactionId: string | null;
  status: PayChanguPayoutExecutionStatus;
  amount: number;
  currency: string;
  attemptNo: number;
  rawResponse: Record<string, unknown>;
  processedAt: string;
  failureClass: PayChanguPayoutFailureClass;
}

export interface PayChanguPayoutBalanceResult {
  provider: 'paychangu';
  currency: string;
  availableBalance: number;
  checkedAt: string;
  rawResponse: Record<string, unknown>;
}

export interface PayChanguPayoutStatusResult {
  provider: 'paychangu';
  chargeId: string;
  reference: string | null;
  transactionId: string | null;
  status: PayChanguPayoutExecutionStatus;
  amount: number | null;
  currency: string | null;
  rawResponse: Record<string, unknown>;
  checkedAt: string;
}

export interface PayChanguMobileMoneyOperatorRecord {
  refId: string;
  name: string;
  raw: Record<string, unknown>;
}

export interface PayChanguBankRecord {
  uuid: string;
  name: string;
  raw: Record<string, unknown>;
}

export interface PayChanguPayoutConfig {
  paychanguSecretKey?: string;
  paychanguWebhookSecret?: string;
  paychanguBaseUrl?: string;
  paychanguPayoutCreatePath?: string;
  paychanguPayoutStatusPath?: string;
  paychanguPayoutBalancePath?: string;
  paychanguMobileMoneyPath?: string;
  paychanguBanksPath?: string;
  paychanguMobileMoneyPayoutPath?: string;
  paychanguBankPayoutPath?: string;
  paychanguTimeoutMs?: number;
}

interface ResolvedPayChanguPayoutConfig {
  paychanguSecretKey: string;
  paychanguWebhookSecret: string;
  paychanguBaseUrl: string;
  paychanguPayoutCreatePath: string;
  paychanguPayoutStatusPath: string;
  paychanguPayoutBalancePath: string;
  paychanguMobileMoneyPath: string;
  paychanguBanksPath: string;
  paychanguMobileMoneyPayoutPath: string;
  paychanguBankPayoutPath: string;
  paychanguTimeoutMs: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function trimPath(value: string): string {
  const cleaned = value.trim();
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function resolveConfig(config: PayChanguPayoutConfig = {}): ResolvedPayChanguPayoutConfig {
  const baseUrl = trimSlash(
    config.paychanguBaseUrl ?? process.env.PAYCHANGU_PAYOUT_BASE_URL ?? process.env.PAYCHANGU_BASE_URL ?? 'https://api.paychangu.com',
  );

  const timeoutMs = Number(
    config.paychanguTimeoutMs ?? process.env.PAYCHANGU_PAYOUT_TIMEOUT_MS ?? 20000,
  );

  return {
    paychanguSecretKey: config.paychanguSecretKey ?? process.env.PAYCHANGU_SECRET_KEY ?? '',
    paychanguWebhookSecret: config.paychanguWebhookSecret ?? process.env.PAYCHANGU_WEBHOOK_SECRET ?? '',
    paychanguBaseUrl: baseUrl,
    paychanguPayoutCreatePath: trimPath(
      config.paychanguPayoutCreatePath ?? process.env.PAYCHANGU_PAYOUT_CREATE_PATH ?? '/direct-charge/payouts/initialize',
    ),
    paychanguPayoutStatusPath: trimPath(
      config.paychanguPayoutStatusPath ?? process.env.PAYCHANGU_PAYOUT_STATUS_PATH ?? '/direct-charge/payouts',
    ),
    paychanguPayoutBalancePath: String(
      config.paychanguPayoutBalancePath ?? process.env.PAYCHANGU_PAYOUT_BALANCE_PATH ?? '/wallet-balance',
    ).trim(),
    paychanguMobileMoneyPath: trimPath(
      config.paychanguMobileMoneyPath ?? process.env.PAYCHANGU_MOBILE_MONEY_PATH ?? '/mobile-money',
    ),
    paychanguBanksPath: trimPath(
      config.paychanguBanksPath ?? process.env.PAYCHANGU_BANKS_PATH ?? '/direct-charge/payouts/supported-banks',
    ),
    paychanguMobileMoneyPayoutPath: trimPath(
      config.paychanguMobileMoneyPayoutPath ?? process.env.PAYCHANGU_MOBILE_MONEY_PAYOUT_PATH ?? process.env.PAYCHANGU_PAYOUT_MOBILE_MONEY_PATH ?? '/mobile-money/payouts/initialize',
    ),
    paychanguBankPayoutPath: trimPath(
      config.paychanguBankPayoutPath ?? process.env.PAYCHANGU_BANK_PAYOUT_PATH ?? process.env.PAYCHANGU_PAYOUT_BANK_PATH ?? '/direct-charge/payouts/initialize',
    ),
    paychanguTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000,
  };
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(`${trimSlash(baseUrl)}${trimPath(path)}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || String(value).trim() === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function resolveEndpoint(
  baseUrl: string,
  pathOrUrl: string,
  query?: Record<string, string | undefined>,
): string {
  const value = pathOrUrl.trim();
  const url = /^https?:\/\//i.test(value)
    ? new URL(value)
    : new URL(`${trimSlash(baseUrl)}${trimPath(value)}`);

  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      url.searchParams.set(key, String(raw));
    }
  }

  return url.toString();
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    return { message: value };
  }
  return { value };
}

async function readResponseBody(response: Response): Promise<{ payload: unknown; rawText: string }> {
  const rawText = await response.text();
  if (!rawText) {
    return { payload: null, rawText: '' };
  }

  try {
    return { payload: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { payload: rawText, rawText };
  }
}

function extractNestedValue(payload: unknown, keys: string[]): unknown {
  let current: unknown = payload;

  for (const key of keys) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    current = record[key];
  }

  return current;
}

function extractNumber(payload: unknown, keys: string[]): number | null {
  const value = extractNestedValue(payload, keys);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractString(payload: unknown, keys: string[]): string | null {
  const value = extractNestedValue(payload, keys);
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function extractProviderReference(payload: unknown): string | null {
  return (
    extractString(payload, ['data', 'transaction', 'reference']) ??
    extractString(payload, ['data', 'transaction', 'ref_id']) ??
    extractString(payload, ['data', 'reference']) ??
    extractString(payload, ['data', 'ref_id']) ??
    extractString(payload, ['reference']) ??
    extractString(payload, ['ref_id'])
  );
}

function extractProviderTransactionId(payload: unknown): string | null {
  return (
    extractString(payload, ['data', 'transaction', 'trans_id']) ??
    extractString(payload, ['data', 'transaction', 'transaction_id']) ??
    extractString(payload, ['data', 'transaction', 'transactionId']) ??
    extractString(payload, ['data', 'transaction', 'id']) ??
    extractString(payload, ['data', 'trans_id']) ??
    extractString(payload, ['data', 'transaction_id']) ??
    extractString(payload, ['data', 'transactionId']) ??
    extractString(payload, ['data', 'id']) ??
    extractString(payload, ['trans_id']) ??
    extractString(payload, ['transaction_id']) ??
    extractString(payload, ['transactionId']) ??
    extractString(payload, ['id'])
  );
}

function normalizeProviderStatus(rawStatus: unknown): PayChanguPayoutExecutionStatus {
  const status = String(rawStatus ?? '').trim().toLowerCase();
  if (['paid', 'success', 'successful', 'succeeded', 'completed', 'approved', 'captured'].includes(status)) {
    return 'paid';
  }
  if (['queued', 'pending', 'initiated'].includes(status)) {
    return 'pending';
  }
  if (['processing', 'processing_payment', 'in_progress'].includes(status)) {
    return 'processing';
  }
  if (['failed', 'declined', 'rejected', 'cancelled', 'canceled', 'expired', 'error'].includes(status)) {
    return 'failed';
  }
  return 'pending';
}

function parsePayChanguList(
  payload: unknown,
  candidatePaths: string[][],
  fallbackKey: string,
): Record<string, unknown>[] {
  for (const path of candidatePaths) {
    const value = extractNestedValue(payload, path);
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item)) as Record<string, unknown>[];
    }
  }

  const direct = extractNestedValue(payload, [fallbackKey]);
  if (Array.isArray(direct)) {
    return direct.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item)) as Record<string, unknown>[];
  }

  return [];
}

function normalizeMobileMoneyOperators(payload: unknown): PayChanguMobileMoneyOperatorRecord[] {
  const records = parsePayChanguList(payload, [['data'], ['data', 'operators'], ['data', 'results']], 'operators');
  return records
    .map((record) => {
      const refId = String(
        record.ref_id ?? record.refId ?? record.operator_ref_id ?? record.operatorRefId ?? record.id ?? '',
      ).trim();
      const name = String(record.name ?? record.operator_name ?? record.title ?? refId).trim();
      return { refId, name, raw: record };
    })
    .filter((record) => record.refId.length > 0);
}

function normalizeBanks(payload: unknown): PayChanguBankRecord[] {
  const records = parsePayChanguList(payload, [['data'], ['data', 'banks'], ['data', 'results']], 'banks');
  return records
    .map((record) => {
      const uuid = String(record.uuid ?? record.bank_uuid ?? record.id ?? '').trim();
      const name = String(record.name ?? record.bank_name ?? record.title ?? uuid).trim();
      return { uuid, name, raw: record };
    })
    .filter((record) => record.uuid.length > 0);
}

function extractPayoutListItems(payload: unknown): Record<string, unknown>[] {
  return parsePayChanguList(
    payload,
    [['data', 'data'], ['data', 'transactions'], ['data', 'results'], ['data', 'items'], ['transactions'], ['results'], ['items']],
    'data',
  );
}

function isSinglePayoutDetailsPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes('{charge_id}') || lower.includes('{chargeid}') || lower.includes('details');
}

function classifyProviderError(error: unknown, httpStatus?: number): PayChanguPayoutFailureClass {
  if (httpStatus !== undefined) {
    if (httpStatus === 429) return 'provider_rate_limited';
    if (httpStatus >= 500 && httpStatus < 600) return 'provider_unavailable';
    if (httpStatus === 401 || httpStatus === 403) return 'provider_authentication_error';
    if (httpStatus === 404) return 'provider_configuration_error';
    if (httpStatus === 409) return 'provider_conflict';
    if (httpStatus === 400 || httpStatus === 422) return 'provider_rejected';
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) {
      return 'provider_timeout';
    }
    if (
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('unavailable') ||
      msg.includes('fetch failed')
    ) {
      return 'provider_unavailable';
    }
  }

  return 'provider_unavailable';
}

function buildPayoutReference(payoutId: string): string {
  return `PAYCHANGU-PAYOUT-${payoutId}-${randomUUID().slice(0, 8)}`;
}

function buildPayChanguJsonHeaders(secretKey: string): Record<string, string> {
  const trimmedSecretKey = secretKey.trim();
  if (!trimmedSecretKey) {
    throw new Error('Missing required PayChangu secret key');
  }

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${trimmedSecretKey}`,
  };
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  secretKey: string,
  timeoutMs: number,
): Promise<{ payload: unknown; rawText: string; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildPayChanguJsonHeaders(secretKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const { payload, rawText } = await readResponseBody(response);
    return { payload, rawText, ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getJson(
  url: string,
  secretKey: string,
  timeoutMs: number,
): Promise<{ payload: unknown; rawText: string; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildPayChanguJsonHeaders(secretKey),
      signal: controller.signal,
    });

    const { payload, rawText } = await readResponseBody(response);
    return { payload, rawText, ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildMobileMoneyBody(input: ExecutePayChanguPayoutInput, providerChargeId: string): Record<string, unknown> {
  return {
    mobile_money_operator_ref_id: input.mobileMoneyOperatorRefId,
    mobile: input.mobile ?? input.destinationReference,
    amount: String(input.amount),
    charge_id: providerChargeId,
    ...(input.email ? { email: input.email } : {}),
    ...(input.firstName ? { first_name: input.firstName } : {}),
    ...(input.lastName ? { last_name: input.lastName } : {}),
    ...(input.transactionStatus ? { transaction_status: input.transactionStatus } : {}),
  };
}

function buildBankBody(input: ExecutePayChanguPayoutInput, providerChargeId: string): Record<string, unknown> {
  return {
    payout_method: 'bank_transfer',
    bank_uuid: input.bankUuid,
    amount: String(input.amount),
    charge_id: providerChargeId,
    bank_account_name: input.bankAccountName ?? input.firstName ?? input.providerName,
    bank_account_number: input.bankAccountNumber ?? input.destinationReference,
  };
}

async function executeStructuredPayChanguPayout(
  input: ExecutePayChanguPayoutInput,
  resolved: ResolvedPayChanguPayoutConfig,
): Promise<PayChanguPayoutExecutionResult> {
  const providerChargeId = buildPayChanguPayoutChargeId(input.payoutId, input.attemptNo);
  const providerReference = buildPayoutReference(input.payoutId);
  const destinationType = input.destinationType ?? 'bank';

  if (destinationType === 'mobile_money') {
    const url = buildUrl(resolved.paychanguBaseUrl, resolved.paychanguMobileMoneyPayoutPath);
    const requestBody = buildMobileMoneyBody(input, providerChargeId);

    try {
      const { payload, rawText, ok, status } = await postJson(url, requestBody, resolved.paychanguSecretKey, resolved.paychanguTimeoutMs);
      const responseRecord = toPlainObject(payload);
      const responseStatus =
        extractString(payload, ['data', 'transaction', 'status']) ??
        extractString(payload, ['data', 'status']) ??
        extractString(payload, ['status']) ??
        null;
      const executionStatus = ok ? normalizeProviderStatus(responseStatus) : 'failed';
      const failureClass: PayChanguPayoutFailureClass = !ok ? classifyProviderError(null, status) : null;
      const responseReference = extractProviderReference(payload);
      const providerTransactionId = extractProviderTransactionId(payload);

      return {
        payoutId: input.payoutId,
        provider: 'paychangu',
        providerChargeId,
        providerReference: responseReference ?? providerReference,
        providerTransactionId,
        status: executionStatus,
        amount: input.amount,
        currency: input.currency,
        attemptNo: input.attemptNo,
        processedAt: nowIso(),
        failureClass,
        rawResponse: {
          httpStatus: status,
          ok,
          request: requestBody,
          response: responseRecord,
          rawText,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PayChangu mobile money payout request failed';
      return {
        payoutId: input.payoutId,
        provider: 'paychangu',
        providerChargeId,
        providerReference,
        providerTransactionId: null,
        status: 'failed',
        amount: input.amount,
        currency: input.currency,
        attemptNo: input.attemptNo,
        processedAt: nowIso(),
        failureClass: classifyProviderError(error),
        rawResponse: {
          error: message,
          request: requestBody,
        },
      };
    }
  }

  const url = buildUrl(resolved.paychanguBaseUrl, resolved.paychanguBankPayoutPath);
  const requestBody = buildBankBody(input, providerChargeId);

  try {
    const { payload, rawText, ok, status } = await postJson(url, requestBody, resolved.paychanguSecretKey, resolved.paychanguTimeoutMs);
    const responseRecord = toPlainObject(payload);
    const responseStatus =
      extractString(payload, ['data', 'transaction', 'status']) ??
      extractString(payload, ['data', 'status']) ??
      extractString(payload, ['status']) ??
      null;
    const executionStatus = ok ? normalizeProviderStatus(responseStatus) : 'failed';
    const failureClass: PayChanguPayoutFailureClass = !ok ? classifyProviderError(null, status) : null;
    const responseReference = extractProviderReference(payload);
    const providerTransactionId = extractProviderTransactionId(payload);

    return {
      payoutId: input.payoutId,
      provider: 'paychangu',
      providerChargeId,
      providerReference: responseReference ?? providerReference,
      providerTransactionId,
      status: executionStatus,
      amount: input.amount,
      currency: input.currency,
      attemptNo: input.attemptNo,
      processedAt: nowIso(),
      failureClass,
      rawResponse: {
        httpStatus: status,
        ok,
        request: requestBody,
        response: responseRecord,
        rawText,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PayChangu bank payout request failed';
    return {
      payoutId: input.payoutId,
      provider: 'paychangu',
      providerChargeId,
      providerReference,
      providerTransactionId: null,
      status: 'failed',
      amount: input.amount,
      currency: input.currency,
      attemptNo: input.attemptNo,
      processedAt: nowIso(),
      failureClass: classifyProviderError(error),
      rawResponse: {
        error: message,
        request: requestBody,
      },
    };
  }
}

async function getPayChanguPayoutStatusFromDetail(
  chargeId: string,
  resolved: ResolvedPayChanguPayoutConfig,
): Promise<PayChanguPayoutStatusResult> {
  const url = buildUrl(
    resolved.paychanguBaseUrl,
    resolved.paychanguPayoutStatusPath.replace('{charge_id}', encodeURIComponent(chargeId)).replace('{chargeId}', encodeURIComponent(chargeId)),
  );
  const { payload, ok, rawText, status } = await getJson(url, resolved.paychanguSecretKey, resolved.paychanguTimeoutMs);

  if (!ok) {
    const message =
      (extractString(payload, ['message']) ?? extractString(payload, ['error']) ?? rawText) ||
      `PayChangu payout status lookup failed (${status})`;
    throw new Error(message);
  }

  const responseRecord = toPlainObject(payload);
  const transaction = extractNestedValue(payload, ['data', 'transaction']) ?? extractNestedValue(payload, ['transaction']) ?? payload;
  const responseStatus = extractString(transaction, ['status']) ?? extractString(payload, ['status']) ?? null;
  const amountValue = extractNumber(transaction, ['amount']) ?? extractNumber(payload, ['amount']);
  const currencyValue = extractString(transaction, ['currency']) ?? extractString(payload, ['currency']);
  const reference =
    extractString(transaction, ['ref_id']) ??
    extractString(transaction, ['reference']) ??
    extractString(payload, ['reference']) ??
    null;
  const transactionId = extractProviderTransactionId(payload);

  return {
    provider: 'paychangu',
    chargeId,
    reference,
    transactionId,
    status: normalizeProviderStatus(responseStatus),
    amount: amountValue,
    currency: currencyValue,
    rawResponse: responseRecord,
    checkedAt: nowIso(),
  };
}

async function getPayChanguPayoutStatusFromList(
  chargeId: string,
  resolved: ResolvedPayChanguPayoutConfig,
): Promise<PayChanguPayoutStatusResult> {
  const perPage = 100;
  const maxPages = 25;

  for (let page = 1; page <= maxPages; page += 1) {
    const { payload, ok, rawText, status } = await getJson(
      buildUrl(resolved.paychanguBaseUrl, resolved.paychanguPayoutStatusPath, {
        page: String(page),
        per_page: String(perPage),
      }),
      resolved.paychanguSecretKey,
      resolved.paychanguTimeoutMs,
    );

    if (!ok) {
      const message =
        (extractString(payload, ['message']) ?? extractString(payload, ['error']) ?? rawText) ||
        `PayChangu payout details lookup failed (${status})`;
      throw new Error(message);
    }

    const responseRecord = toPlainObject(payload);
    const items = extractPayoutListItems(payload);
    const match = items.find((record) => {
      const rowChargeId = String(
        record.charge_id ?? record.chargeId ?? record.provider_charge_id ?? record.id ?? '',
      ).trim();
      return rowChargeId === chargeId;
    });

    if (match) {
      return {
        provider: 'paychangu',
        chargeId,
        reference:
          extractString(match, ['ref_id']) ??
          extractString(match, ['reference']) ??
          null,
        transactionId: extractProviderTransactionId(match),
        status: normalizeProviderStatus(extractString(match, ['status']) ?? null),
        amount: extractNumber(match, ['amount']),
        currency: extractString(match, ['currency']),
        rawResponse: {
          httpStatus: status,
          page,
          perPage,
          response: responseRecord,
          matchedRow: match,
          rawText,
        },
        checkedAt: nowIso(),
      };
    }

    const totalPages = extractNumber(payload, ['data', 'total_pages']) ?? extractNumber(payload, ['total_pages']);
    const nextPageUrl = extractString(payload, ['data', 'next_page_url']) ?? extractString(payload, ['next_page_url']);

    if (typeof totalPages === 'number' && page >= totalPages) {
      break;
    }
    if (!totalPages && (!nextPageUrl || items.length < perPage)) {
      break;
    }
  }

  throw new Error(`PayChangu payout ${chargeId} not found in payout listing`);
}

export async function executePayChanguPayout(
  input: ExecutePayChanguPayoutInput,
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguPayoutExecutionResult> {
  const resolved = resolveConfig(config);

  if (!input.destinationType) {
    throw new Error('PayChangu payout destinationType is required');
  }

  if (input.destinationType !== 'mobile_money' && input.destinationType !== 'bank') {
    throw new Error(`Unsupported payout destination type: ${input.destinationType}`);
  }

  if (input.destinationType === 'mobile_money' && !input.mobileMoneyOperatorRefId) {
    throw new Error('PayChangu mobile money payout requires mobileMoneyOperatorRefId');
  }

  if (input.destinationType === 'bank' && !input.bankUuid) {
    throw new Error('PayChangu bank payout requires bankUuid');
  }

  return executeStructuredPayChanguPayout(input, resolved);
}

export async function listPayChanguMobileMoneyOperators(
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguMobileMoneyOperatorRecord[]> {
  const resolved = resolveConfig(config);
  const { payload, ok, rawText, status } = await getJson(
    buildUrl(resolved.paychanguBaseUrl, resolved.paychanguMobileMoneyPath),
    resolved.paychanguSecretKey,
    resolved.paychanguTimeoutMs,
  );

  if (!ok) {
    const message =
      (extractString(payload, ['message']) ?? extractString(payload, ['error']) ?? rawText) ||
      `PayChangu mobile money operator lookup failed (${status})`;
    throw new Error(message);
  }

  return normalizeMobileMoneyOperators(payload);
}

export async function listPayChanguPayoutBanks(
  currency = 'MWK',
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguBankRecord[]> {
  const resolved = resolveConfig(config);
  const { payload, ok, rawText, status } = await getJson(
    buildUrl(resolved.paychanguBaseUrl, resolved.paychanguBanksPath, { currency }),
    resolved.paychanguSecretKey,
    resolved.paychanguTimeoutMs,
  );

  if (!ok) {
    const message =
      (extractString(payload, ['message']) ?? extractString(payload, ['error']) ?? rawText) ||
      `PayChangu bank lookup failed (${status})`;
    throw new Error(message);
  }

  return normalizeBanks(payload);
}

export async function initializePayChanguMobileMoneyPayout(
  input: Omit<ExecutePayChanguPayoutInput, 'destinationType'> & {
    mobile: string;
    mobileMoneyOperatorRefId: string;
  },
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguPayoutExecutionResult> {
  return executePayChanguPayout(
    {
      ...input,
      destinationType: 'mobile_money',
    },
    config,
  );
}

export async function initializePayChanguBankPayout(
  input: Omit<ExecutePayChanguPayoutInput, 'destinationType'> & {
    bankUuid: string;
    bankAccountName: string;
    bankAccountNumber: string;
  },
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguPayoutExecutionResult> {
  return executePayChanguPayout(
    {
      ...input,
      destinationType: 'bank',
    },
    config,
  );
}

export async function getPayChanguPayoutStatus(
  chargeId: string,
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguPayoutStatusResult> {
  const resolved = resolveConfig(config);
  if (isSinglePayoutDetailsPath(resolved.paychanguPayoutStatusPath)) {
    return getPayChanguPayoutStatusFromDetail(chargeId, resolved);
  }
  try {
    return await getPayChanguPayoutStatusFromList(chargeId, resolved);
  } catch {
    const detailResolved = {
      ...resolved,
      paychanguPayoutStatusPath: `/mobile-money/payments/${encodeURIComponent(chargeId)}/details`,
    };
    return getPayChanguPayoutStatusFromDetail(chargeId, detailResolved);
  }
}

export async function verifyPayChanguPayoutWebhook(
  signature: string | undefined,
  payload: string | Record<string, unknown>,
  config: PayChanguPayoutConfig = {},
) {
  const resolved = resolveConfig(config);
  return paychanguProvider.verifyWebhook(signature, payload, {
    paychanguWebhookSecret: config.paychanguWebhookSecret ?? process.env.PAYCHANGU_WEBHOOK_SECRET ?? process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET ?? '',
    paychanguSecretKey: resolved.paychanguSecretKey,
    paychanguBaseUrl: resolved.paychanguBaseUrl,
  });
}

export async function getPayChanguPayoutBalance(
  currency = 'MWK',
  config: PayChanguPayoutConfig = {},
): Promise<PayChanguPayoutBalanceResult> {
  const resolved = resolveConfig(config);
  const balanceUrl = resolveEndpoint(
    resolved.paychanguBaseUrl,
    resolved.paychanguPayoutBalancePath,
    { currency },
  );

  console.log("PAYCHANGU BALANCE REQUEST START", {
    url: balanceUrl,
    currency,
    timeoutMs: resolved.paychanguTimeoutMs,
  });

  const { payload, rawText, ok, status } = await getJson(
    balanceUrl,
    resolved.paychanguSecretKey,
    resolved.paychanguTimeoutMs,
  );

  if (!ok) {
    const message =
      (extractString(payload, ['message']) ?? extractString(payload, ['error']) ?? rawText) ||
      `PayChangu balance lookup failed (${status})`;
    throw new Error(message);
  }

  const availableBalance =
    extractNumber(payload, ['data', 'main_balance']) ??
    extractNumber(payload, ['data', 'available_balance']) ??
    extractNumber(payload, ['data', 'balance']) ??
    extractNumber(payload, ['main_balance']) ??
    extractNumber(payload, ['available_balance']) ??
    extractNumber(payload, ['balance']) ??
    0;

  const balanceCurrency =
    extractString(payload, ['data', 'currency']) ??
    extractString(payload, ['currency']) ??
    currency;

  console.log("PAYCHANGU BALANCE REQUEST DONE", {
    url: balanceUrl,
    currency,
    ok,
    status,
    availableBalance,
    balanceCurrency,
  });

  return {
    provider: 'paychangu',
    currency: balanceCurrency,
    availableBalance,
    checkedAt: nowIso(),
    rawResponse: toPlainObject(payload),
  };
}

export function isPaychanguSuccessStatus(status: string | undefined): boolean {
  return normalizePaychanguPayoutStatus(status) === 'paid';
}

export function buildPayChanguPayoutReference(payoutId: string): string {
  return `PAYCHANGU-PAYOUT-${payoutId}-${randomUUID().slice(0, 8)}`;
}

export { buildPayChanguPayoutChargeId } from '../payments/paychangu.flow.js';

export function normalizePaychanguPayoutStatus(
  status: string | undefined,
): PayChanguPayoutExecutionStatus {
  return normalizeProviderStatus(status);
}
