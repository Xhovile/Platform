export type PayChanguConnectMode = 'live' | 'test';
export type PayChanguConnectStatus = 'pending' | 'connected' | 'revoked' | 'error';
export type ConnectAttemptStatus = 'pending' | 'consumed' | 'expired';

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

export interface PayChanguConnectStartResponse {
  connectAttemptId: string;
  authorizationUrl: string;
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
  connectUser?: PayChanguConnectUserProfile | null;
  rawPayload?: Record<string, unknown> | null;
}

export interface PayChanguConnectUserProfile {
  id: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  status?: string | null;
  rawResponse?: Record<string, unknown> | null;
}

export interface SellerConnectAccount {
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
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  webhookUrl?: string | null;
  webhookSecretEncrypted?: string | null;
  connectedAt?: string | null;
  revokedAt?: string | null;
  lastError?: string | null;
  rawProfile?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SellerConnectAccountUpsertInput {
  sellerUid: string;
  status?: PayChanguConnectStatus;
  mode: PayChanguConnectMode;
  scope?: string | null;
  authorizationUrl?: string | null;
  connectUserId?: string | null;
  connectUserEmail?: string | null;
  connectUserName?: string | null;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  webhookUrl?: string | null;
  webhookSecretEncrypted?: string | null;
  connectedAt?: string | null;
  revokedAt?: string | null;
  lastError?: string | null;
  rawProfile?: Record<string, unknown> | null;
}

export interface ConnectAttemptRecord {
  id: string;
  sellerUid: string;
  status: ConnectAttemptStatus;
  expiresAt: string;
  consumedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectAttemptCreateInput {
  id?: string;
  sellerUid: string;
  status?: ConnectAttemptStatus;
  expiresAt: string;
  consumedAt?: string | null;
  metadata?: Record<string, unknown> | null;
}
