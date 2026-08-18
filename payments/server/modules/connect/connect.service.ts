import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'crypto';
import { connectRepository } from './connect.repository.js';
import type {
  PayChanguConnectAuthorizeLinkRequest,
  PayChanguConnectCallbackPayload,
  PayChanguConnectMode,
  PayChanguConnectStartRequest,
  PayChanguConnectStartResponse,
  PayChanguConnectUserProfile,
  SellerConnectAccount,
  SellerConnectAccountUpsertInput,
} from './connect.types.js';

const PAYCHANGU_API_BASE_URL = process.env.PAYCHANGU_BASE_URL ?? process.env.PAYCHANGU_API_BASE_URL ?? 'https://api.paychangu.com';
const PAYCHANGU_REVOKE_ACCESS_TOKEN_PATH = process.env.PAYCHANGU_REVOKE_ACCESS_TOKEN_PATH ?? '/new-endpoint-2';
const CONNECT_ATTEMPT_TTL_MS = 15 * 60 * 1000;

type ConnectAuthorizationUrlInput = Pick<
  PayChanguConnectAuthorizeLinkRequest,
  'clientId' | 'redirectUri' | 'mode' | 'scope' | 'whUrl' | 'whSecret'
>;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required Connect environment variable: ${name}`);
  }

  return value;
}

function getConnectTokenEncryptionKey(): string {
  return process.env.CONNECT_TOKEN_ENCRYPTION_KEY?.trim()
    || process.env.SELLER_PAYOUT_ENCRYPTION_KEY?.trim()
    || '';
}

function validateBaseUrl(value: string): string {
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`PAYCHANGU_BASE_URL must be a valid URL: ${value}`);
  }
}

export function validateConnectEnvironment(): void {
  const missing: string[] = [];
  if (!process.env.PAYCHANGU_SECRET_KEY?.trim()) missing.push('PAYCHANGU_SECRET_KEY');
  if (!process.env.PAYCHANGU_WEBHOOK_SECRET?.trim()) missing.push('PAYCHANGU_WEBHOOK_SECRET');
  if (!getConnectTokenEncryptionKey()) missing.push('CONNECT_TOKEN_ENCRYPTION_KEY');

  if (missing.length > 0) {
    throw new Error(`Missing required Connect environment variables: ${missing.join(', ')}`);
  }

  validateBaseUrl(PAYCHANGU_API_BASE_URL);
}

function requireEncryptionKey(): string {
  const key = getConnectTokenEncryptionKey();
  if (!key) {
    throw new Error('CONNECT_TOKEN_ENCRYPTION_KEY is not configured');
  }

  return key;
}

function getDerivedKey(): Buffer {
  return scryptSync(requireEncryptionKey(), 'BuyMesho connect token', 32);
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const key = getDerivedKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;

  const parts = value.split(':');
  if (parts.length !== 3) {
    return value;
  }

  try {
    const key = getDerivedKey();
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return `${decipher.update(encrypted, undefined, 'utf8')}${decipher.final('utf8')}`;
  } catch {
    return null;
  }
}

export function buildConnectAuthorizationUrl(input: ConnectAuthorizationUrlInput): string {
  const url = new URL('/connect/authorize-link', PAYCHANGU_API_BASE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('mode', input.mode);

  if (input.scope) {
    url.searchParams.set('scope', input.scope);
  }

  if (input.whUrl) {
    url.searchParams.set('wh_url', input.whUrl);
  }

  if (input.whSecret) {
    url.searchParams.set('wh_secret', input.whSecret);
  }

  return url.toString();
}

function buildAttemptMetadata(input: PayChanguConnectStartRequest): Record<string, unknown> {
  return {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    mode: input.mode,
    scope: input.scope ?? null,
    whUrl: input.whUrl ?? null,
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
  };
}

function ensureSellerExists(sellerUid: string): void {
  if (!connectRepository.sellerExists(sellerUid)) {
    throw new Error('Seller account not found');
  }
}

function validateStartRequest(input: PayChanguConnectStartRequest): PayChanguConnectStartRequest {
  const clientId = input.clientId?.trim();
  const redirectUri = input.redirectUri?.trim();
  const mode = input.mode;
  const scope = input.scope?.trim();
  const whUrl = input.whUrl?.trim();
  const whSecret = input.whSecret?.trim();

  if (!clientId) {
    throw new Error('VITE_PAYCHANGU_CLIENT_ID is not configured');
  }

  if (!redirectUri) {
    throw new Error('redirectUri is required');
  }

  try {
    new URL(redirectUri);
  } catch {
    throw new Error(`redirectUri must be a valid URL: ${redirectUri}`);
  }

  if (mode !== 'live' && mode !== 'test') {
    throw new Error('VITE_PAYCHANGU_MODE must be "live" or "test"');
  }

  if (!whUrl) {
    throw new Error('VITE_PAYCHANGU_WEBHOOK_URL is not configured');
  }

  try {
    new URL(whUrl);
  } catch {
    throw new Error(`VITE_PAYCHANGU_WEBHOOK_URL must be a valid URL: ${whUrl}`);
  }

  if (!whSecret) {
    throw new Error('VITE_PAYCHANGU_WEBHOOK_SECRET is not configured');
  }

  return {
    clientId,
    redirectUri,
    mode,
    scope: scope || undefined,
    whUrl,
    whSecret,
    metadata: input.metadata ?? null,
  };
}

export function startConnectOnboarding(
  input: PayChanguConnectStartRequest & { sellerUid: string },
): PayChanguConnectStartResponse {
  validateConnectEnvironment();
  ensureSellerExists(input.sellerUid);

  const validated = validateStartRequest(input);
  const connectAttemptId = randomUUID();
  const expiresAt = new Date(Date.now() + CONNECT_ATTEMPT_TTL_MS).toISOString();

  connectRepository.createConnectAttempt({
    id: connectAttemptId,
    sellerUid: input.sellerUid,
    status: 'pending',
    expiresAt,
    metadata: buildAttemptMetadata(validated),
  });

  const authorizationUrl = buildConnectAuthorizationUrl({
    clientId: validated.clientId,
    redirectUri: validated.redirectUri,
    mode: validated.mode,
    scope: validated.scope,
    whUrl: validated.whUrl,
    whSecret: validated.whSecret,
  });

  return {
    connectAttemptId,
    authorizationUrl,
  };
}

export function saveConnectAccount(input: SellerConnectAccountUpsertInput): SellerConnectAccount {
  return connectRepository.upsert(input);
}

export async function fetchConnectedUser(accessToken: string): Promise<PayChanguConnectUserProfile> {
  const url = new URL('/connect/user', PAYCHANGU_API_BASE_URL);
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PayChangu Connect user: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    id: String(payload.id ?? payload.user_id ?? payload.sub ?? randomUUID()),
    email: (payload.email as string | null) ?? null,
    name: (payload.name as string | null) ?? null,
    phone: (payload.phone as string | null) ?? null,
    status: (payload.status as string | null) ?? null,
    rawResponse: payload,
  };
}

function buildRevokeAccessTokenUrl(accessToken: string): URL {
  const url = new URL(PAYCHANGU_REVOKE_ACCESS_TOKEN_PATH, PAYCHANGU_API_BASE_URL);
  url.searchParams.set('token', accessToken);
  return url;
}

export async function revokeConnectAccessToken(
  sellerUid: string,
  reason: string | null = 'Seller disconnected PayChangu Connect',
): Promise<SellerConnectAccount> {
  validateConnectEnvironment();

  const existing = connectRepository.findBySellerUid(sellerUid);
  if (!existing) {
    return connectRepository.revoke(sellerUid, reason);
  }

  const accessToken = decryptSecret(existing.accessTokenEncrypted);
  if (!accessToken) {
    return connectRepository.revoke(sellerUid, reason);
  }

  const response = await fetch(buildRevokeAccessTokenUrl(accessToken), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readRequiredEnv('PAYCHANGU_SECRET_KEY')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Failed to revoke PayChangu Connect access token: ${response.status}`);
  }

  return connectRepository.revoke(sellerUid, reason);
}

export async function recordConnectCallback(input: PayChanguConnectCallbackPayload): Promise<SellerConnectAccount> {
  validateConnectEnvironment();

  if (!input.sellerUid) {
    throw new Error('sellerUid is required');
  }

  const connectUser = input.connectUser ?? (input.accessToken ? await fetchConnectedUser(input.accessToken) : null);
  const authorizationUrl = input.authorizationUrl ?? null;

  return connectRepository.upsert({
    sellerUid: input.sellerUid,
    status: input.accessToken ? 'connected' : 'pending',
    mode: input.mode ?? 'test',
    scope: input.scope ?? null,
    authorizationUrl,
    connectUserId: connectUser?.id ?? null,
    connectUserEmail: connectUser?.email ?? null,
    connectUserName: connectUser?.name ?? null,
    accessTokenEncrypted: input.accessToken ? encryptSecret(input.accessToken) : null,
    refreshTokenEncrypted: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    webhookUrl: input.webhookUrl ?? null,
    webhookSecretEncrypted: input.webhookSecret ? encryptSecret(input.webhookSecret) : null,
    connectedAt: input.accessToken ? new Date().toISOString() : null,
    revokedAt: null,
    lastError: null,
    rawProfile: connectUser?.rawResponse ?? input.rawPayload ?? null,
  });
}

export function getConnectAccount(sellerUid: string): SellerConnectAccount | undefined {
  return connectRepository.findBySellerUid(sellerUid);
}

export function disconnectConnectAccount(
  sellerUid: string,
  reason: string | null = 'Seller disconnected PayChangu Connect',
): Promise<SellerConnectAccount> {
  return revokeConnectAccessToken(sellerUid, reason);
}
