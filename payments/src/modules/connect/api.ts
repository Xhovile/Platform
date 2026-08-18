import { apiFetch } from '../../lib/api';

export type PayChanguConnectMode = 'live' | 'test';
export type PayChanguConnectStatus = 'pending' | 'connected' | 'revoked' | 'error';

const CONNECT_CONTEXT_STORAGE_KEY = 'buymesho.paychangu.connectContext';

export interface PayChanguConnectAuthorizeLinkRequest {
  sellerUid: string;
  clientId: string;
  redirectUri: string;
  mode: PayChanguConnectMode;
  scope?: string;
  whUrl?: string;
  whSecret?: string;
}

export interface PayChanguConnectStartRequest {
  clientId: string;
  redirectUri: string;
  mode: PayChanguConnectMode;
  scope?: string;
  whUrl?: string;
  whSecret?: string;
  metadata?: Record<string, unknown> | null;
}

export interface PayChanguConnectAuthorizeLinkResponse {
  connectAttemptId: string;
  authorizationUrl: string;
}

export interface PayChanguConnectStartResponse {
  connectAttemptId: string;
  authorizationUrl: string;
}

export interface PayChanguConnectAccount {
  id: string;
  sellerUid: string;
  providerName: 'paychangu';
  status: PayChanguConnectStatus;
  mode: PayChanguConnectMode;
  scope?: string | null;
  authorizationUrl?: string | null;
  connectUserId?: string | null;
  connectUserEmail?: string | null;
  connectUserName?: string | null;
  connectedAt?: string | null;
  revokedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayChanguConnectCallbackPayload {
  sellerUid: string;
  connectAttemptId?: string | null;
  accessToken?: string;
  refreshToken?: string | null;
  mode?: PayChanguConnectMode;
  scope?: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  authorizationUrl?: string | null;
  rawPayload?: Record<string, unknown> | null;
}

function readRequiredString(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!text) {
    throw new Error(`${label} is not configured`);
  }

  return text;
}

function validateUrl(value: string, label: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}

export function validateConnectStartPayload(payload: PayChanguConnectStartRequest): PayChanguConnectStartRequest {
  const clientId = readRequiredString(payload.clientId, 'VITE_PAYCHANGU_CLIENT_ID');
  const redirectUri = validateUrl(readRequiredString(payload.redirectUri, 'redirectUri'), 'redirectUri');
  const mode = payload.mode;
  const whUrl = validateUrl(readRequiredString(payload.whUrl, 'VITE_PAYCHANGU_WEBHOOK_URL'), 'VITE_PAYCHANGU_WEBHOOK_URL');
  const whSecret = readRequiredString(payload.whSecret, 'VITE_PAYCHANGU_WEBHOOK_SECRET');
  const scope = typeof payload.scope === 'string' ? payload.scope.trim() : undefined;

  if (mode !== 'live' && mode !== 'test') {
    throw new Error('mode must be "live" or "test"');
  }

  return {
    clientId,
    redirectUri,
    mode,
    scope: scope || undefined,
    whUrl,
    whSecret,
    metadata: payload.metadata ?? null,
  };
}

function normalizeConnectAccount(response: unknown): PayChanguConnectAccount {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid Connect account response');
  }

  const account = response as Record<string, unknown>;

  return {
    id: String(account.id ?? ''),
    sellerUid: String(account.sellerUid ?? account.seller_uid ?? ''),
    providerName: 'paychangu',
    status: (account.status as PayChanguConnectStatus) ?? 'pending',
    mode: (account.mode as PayChanguConnectMode) ?? 'test',
    scope: (account.scope as string | null) ?? null,
    authorizationUrl: (account.authorizationUrl as string | null) ?? (account.authorization_url as string | null) ?? null,
    connectUserId: (account.connectUserId as string | null) ?? (account.connect_user_id as string | null) ?? null,
    connectUserEmail: (account.connectUserEmail as string | null) ?? (account.connect_user_email as string | null) ?? null,
    connectUserName: (account.connectUserName as string | null) ?? (account.connect_user_name as string | null) ?? null,
    connectedAt: (account.connectedAt as string | null) ?? (account.connected_at as string | null) ?? null,
    revokedAt: (account.revokedAt as string | null) ?? (account.revoked_at as string | null) ?? null,
    lastError: (account.lastError as string | null) ?? (account.last_error as string | null) ?? null,
    createdAt: String(account.createdAt ?? account.created_at ?? ''),
    updatedAt: String(account.updatedAt ?? account.updated_at ?? ''),
  };
}

function saveConnectContext(payload: { sellerUid: string; connectAttemptId: string; startedAt: string }): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(CONNECT_CONTEXT_STORAGE_KEY, JSON.stringify(payload));
}

export function getStoredConnectContext(): { sellerUid: string; connectAttemptId: string; startedAt: string } | null {
  if (typeof window === 'undefined') return null;

  const raw = window.sessionStorage.getItem(CONNECT_CONTEXT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<{ sellerUid: string; connectAttemptId: string; startedAt: string }>;
    if (!parsed.sellerUid || !parsed.connectAttemptId || !parsed.startedAt) return null;
    return {
      sellerUid: parsed.sellerUid,
      connectAttemptId: parsed.connectAttemptId,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export function clearStoredConnectContext(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(CONNECT_CONTEXT_STORAGE_KEY);
}

export async function startConnectOnboarding(
  payload: PayChanguConnectStartRequest,
): Promise<PayChanguConnectStartResponse> {
  const validatedPayload = validateConnectStartPayload(payload);
  const response = await apiFetch('/api/connect/start', {
    method: 'POST',
    body: JSON.stringify(validatedPayload),
  });

  return {
    connectAttemptId: String(response?.connectAttemptId ?? response?.connect_attempt_id ?? ''),
    authorizationUrl: String(response?.authorizationUrl ?? response?.authorization_url ?? ''),
  };
}

export async function createConnectAuthorizationLink(
  payload: PayChanguConnectAuthorizeLinkRequest,
): Promise<PayChanguConnectAuthorizeLinkResponse> {
  const { sellerUid, ...startPayload } = payload;
  const result = await startConnectOnboarding(startPayload);

  if (sellerUid && result.connectAttemptId) {
    saveConnectContext({
      sellerUid,
      connectAttemptId: result.connectAttemptId,
      startedAt: new Date().toISOString(),
    });
  }

  return result;
}

export async function getConnectAccount(sellerUid: string): Promise<PayChanguConnectAccount | null> {
  const response = await apiFetch(`/api/connect/status/${encodeURIComponent(sellerUid)}`);
  if (!response) return null;
  return normalizeConnectAccount(response);
}

export async function submitConnectCallback(payload: PayChanguConnectCallbackPayload): Promise<PayChanguConnectAccount> {
  const response = await apiFetch('/api/connect/callback', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return normalizeConnectAccount(response);
}

export async function disconnectConnectAccount(
  sellerUid: string,
  reason?: string,
): Promise<PayChanguConnectAccount> {
  const response = await apiFetch(`/api/connect/disconnect/${encodeURIComponent(sellerUid)}`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

  return normalizeConnectAccount(response);
}
