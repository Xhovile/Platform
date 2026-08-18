export interface PayChanguMobileMoneyDetailsResult {
  provider: 'paychangu';
  chargeId: string;
  reference: string | null;
  transactionId: string | null;
  status: 'pending' | 'paid' | 'failed';
  amount: number | null;
  currency: string | null;
  mobile: string | null;
  rawResponse: Record<string, unknown>;
  checkedAt: string;
}

export interface PayChanguMobileMoneyDetailsConfig {
  paychanguSecretKey?: string;
  paychanguBaseUrl?: string;
  paychanguMobileMoneyDetailsPath?: string;
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

function resolveConfig(config: PayChanguMobileMoneyDetailsConfig = {}) {
  const baseUrl = trimSlash(
    config.paychanguBaseUrl ??
      process.env.PAYCHANGU_PAYOUT_BASE_URL ??
      process.env.PAYCHANGU_BASE_URL ??
      'https://api.paychangu.com',
  );

  return {
    paychanguSecretKey: config.paychanguSecretKey ?? process.env.PAYCHANGU_SECRET_KEY ?? '',
    paychanguBaseUrl: baseUrl,
    paychanguMobileMoneyDetailsPath: trimPath(
      config.paychanguMobileMoneyDetailsPath ??
        process.env.PAYCHANGU_MOBILE_MONEY_DETAILS_PATH ??
        '/mobile-money/payments/{chargeId}/details',
    ),
  };
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(`${trimSlash(baseUrl)}${trimPath(path)}`).toString();
}

function buildHeaders(secretKey: string): Record<string, string> {
  const key = secretKey.trim();
  if (!key) throw new Error('Missing required PayChangu secret key');

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function readNested(payload: unknown, keys: string[]): unknown {
  let current: unknown = payload;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function pickString(payload: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const value = readNested(payload, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(payload: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = readNested(payload, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeStatus(raw: unknown): 'pending' | 'paid' | 'failed' {
  const status = String(raw ?? '').trim().toLowerCase();
  if (['success', 'successful', 'paid', 'completed', 'approved', 'captured'].includes(status)) return 'paid';
  if (['failed', 'declined', 'rejected', 'cancelled', 'canceled', 'expired', 'error'].includes(status)) return 'failed';
  return 'pending';
}

export async function getPayChanguMobileMoneyPayoutDetails(
  chargeId: string,
  config: PayChanguMobileMoneyDetailsConfig = {},
): Promise<PayChanguMobileMoneyDetailsResult> {
  const resolved = resolveConfig(config);
  const path = resolved.paychanguMobileMoneyDetailsPath
    .replace('{chargeId}', encodeURIComponent(chargeId))
    .replace('{charge_id}', encodeURIComponent(chargeId));

  const response = await fetch(buildUrl(resolved.paychanguBaseUrl, path), {
    method: 'GET',
    headers: buildHeaders(resolved.paychanguSecretKey),
  });

  const rawText = await response.text();
  let payload: unknown = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const message =
      pickString(payload, [['message'], ['error']]) ??
      rawText ??
      `PayChangu mobile money payout details lookup failed (${response.status})`;
    throw new Error(message);
  }

  const body = toObject(payload);
  const data = typeof body.data === 'object' && body.data !== null ? (body.data as Record<string, unknown>) : body;

  return {
    provider: 'paychangu',
    chargeId,
    reference: pickString(data, [['ref_id'], ['reference']]),
    transactionId: pickString(data, [['trans_id'], ['transaction_id'], ['id']]),
    status: normalizeStatus(pickString(data, [['status']]) ?? pickString(body, [['status']]) ?? null),
    amount: pickNumber(data, [['amount']]),
    currency: pickString(data, [['currency']]),
    mobile: pickString(data, [['mobile']]),
    rawResponse: body,
    checkedAt: nowIso(),
  };
}