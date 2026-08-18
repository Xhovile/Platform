import { randomUUID } from 'crypto';
import { getPaymentDb } from '../../postgresCompat.js';
import type {
  ConnectAttemptCreateInput,
  ConnectAttemptRecord,
  ConnectAttemptStatus,
  PayChanguConnectMode,
  PayChanguConnectStatus,
  SellerConnectAccount,
  SellerConnectAccountUpsertInput,
} from './connect.types.js';

function rowToConnectAccount(row: Record<string, unknown>): SellerConnectAccount {
  return {
    id: String(row.id),
    sellerUid: String(row.seller_uid),
    providerName: 'paychangu',
    status: String(row.status) as PayChanguConnectStatus,
    mode: String(row.mode) as PayChanguConnectMode,
    scope: (row.scope as string | null) ?? null,
    authorizationUrl: (row.authorization_url as string | null) ?? null,
    connectUserId: (row.connect_user_id as string | null) ?? null,
    connectUserEmail: (row.connect_user_email as string | null) ?? null,
    connectUserName: (row.connect_user_name as string | null) ?? null,
    accessTokenEncrypted: (row.access_token_encrypted as string | null) ?? null,
    refreshTokenEncrypted: (row.refresh_token_encrypted as string | null) ?? null,
    webhookUrl: (row.webhook_url as string | null) ?? null,
    webhookSecretEncrypted: (row.webhook_secret_encrypted as string | null) ?? null,
    connectedAt: (row.connected_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    rawProfile: (() => {
      const rawProfile = row.raw_profile;
      if (!rawProfile) return null;
      if (typeof rawProfile === 'string') {
        try {
          return JSON.parse(rawProfile) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      if (typeof rawProfile === 'object') {
        return rawProfile as Record<string, unknown>;
      }
      return null;
    })(),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToConnectAttempt(row: Record<string, unknown>): ConnectAttemptRecord {
  return {
    id: String(row.id),
    sellerUid: String(row.seller_uid),
    status: String(row.status) as ConnectAttemptStatus,
    expiresAt: String(row.expires_at),
    consumedAt: (row.consumed_at as string | null) ?? null,
    metadata: (() => {
      const metadata = row.metadata;
      if (!metadata) return null;
      if (typeof metadata === 'string') {
        try {
          return JSON.parse(metadata) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      if (typeof metadata === 'object') {
        return metadata as Record<string, unknown>;
      }
      return null;
    })(),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ConnectRepository {
  private get db() {
    return getPaymentDb();
  }

  sellerExists(sellerUid: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1
         FROM sellers
         WHERE uid = ?
         LIMIT 1`,
      )
      .get(sellerUid) as Record<string, unknown> | undefined;

    return Boolean(row);
  }

  findBySellerUid(sellerUid: string): SellerConnectAccount | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM seller_connect_accounts
         WHERE seller_uid = ?
         LIMIT 1`,
      )
      .get(sellerUid) as Record<string, unknown> | undefined;

    return row ? rowToConnectAccount(row) : undefined;
  }

  findById(id: string): SellerConnectAccount | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM seller_connect_accounts
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToConnectAccount(row) : undefined;
  }

  createConnectAttempt(input: ConnectAttemptCreateInput): ConnectAttemptRecord {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO connect_attempts (
          id,
          seller_uid,
          status,
          expires_at,
          consumed_at,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @seller_uid,
          @status,
          @expires_at,
          @consumed_at,
          @metadata,
          @created_at,
          @updated_at
        )`,
      )
      .run({
        id,
        seller_uid: input.sellerUid,
        status: input.status ?? 'pending',
        expires_at: input.expiresAt,
        consumed_at: input.consumedAt ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        created_at: now,
        updated_at: now,
      });

    const stored = this.findConnectAttemptById(id);
    if (!stored) {
      throw new Error('Failed to persist Connect attempt');
    }

    return stored;
  }

  findConnectAttemptById(id: string): ConnectAttemptRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM connect_attempts
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToConnectAttempt(row) : undefined;
  }

  markConnectAttemptConsumed(id: string, consumedAt: string = new Date().toISOString()): ConnectAttemptRecord {
    const existing = this.findConnectAttemptById(id);
    if (!existing) {
      throw new Error('Connect attempt not found');
    }

    this.db
      .prepare(
        `UPDATE connect_attempts
         SET status = 'consumed',
             consumed_at = @consumed_at,
             updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        consumed_at: consumedAt,
        updated_at: new Date().toISOString(),
      });

    const stored = this.findConnectAttemptById(id);
    if (!stored) {
      throw new Error('Failed to update Connect attempt');
    }

    return stored;
  }

  markConnectAttemptExpired(id: string, expiredAt: string = new Date().toISOString()): ConnectAttemptRecord {
    const existing = this.findConnectAttemptById(id);
    if (!existing) {
      throw new Error('Connect attempt not found');
    }

    this.db
      .prepare(
        `UPDATE connect_attempts
         SET status = 'expired',
             updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        updated_at: expiredAt,
      });

    const stored = this.findConnectAttemptById(id);
    if (!stored) {
      throw new Error('Failed to update Connect attempt');
    }

    return stored;
  }

  upsert(input: SellerConnectAccountUpsertInput): SellerConnectAccount {
    const existing = this.findBySellerUid(input.sellerUid);
    const now = new Date().toISOString();
    const id = existing?.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO seller_connect_accounts (
          id,
          seller_uid,
          provider_name,
          status,
          mode,
          scope,
          authorization_url,
          connect_user_id,
          connect_user_email,
          connect_user_name,
          access_token_encrypted,
          refresh_token_encrypted,
          webhook_url,
          webhook_secret_encrypted,
          connected_at,
          revoked_at,
          last_error,
          raw_profile,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @seller_uid,
          'paychangu',
          @status,
          @mode,
          @scope,
          @authorization_url,
          @connect_user_id,
          @connect_user_email,
          @connect_user_name,
          @access_token_encrypted,
          @refresh_token_encrypted,
          @webhook_url,
          @webhook_secret_encrypted,
          @connected_at,
          @revoked_at,
          @last_error,
          @raw_profile,
          @created_at,
          @updated_at
        )
        ON CONFLICT(seller_uid) DO UPDATE SET
          status = excluded.status,
          mode = excluded.mode,
          scope = excluded.scope,
          authorization_url = excluded.authorization_url,
          connect_user_id = excluded.connect_user_id,
          connect_user_email = excluded.connect_user_email,
          connect_user_name = excluded.connect_user_name,
          access_token_encrypted = excluded.access_token_encrypted,
          refresh_token_encrypted = excluded.refresh_token_encrypted,
          webhook_url = excluded.webhook_url,
          webhook_secret_encrypted = excluded.webhook_secret_encrypted,
          connected_at = excluded.connected_at,
          revoked_at = excluded.revoked_at,
          last_error = excluded.last_error,
          raw_profile = excluded.raw_profile,
          updated_at = excluded.updated_at`,
      )
      .run({
        id,
        seller_uid: input.sellerUid,
        status: input.status ?? 'pending',
        mode: input.mode,
        scope: input.scope ?? null,
        authorization_url: input.authorizationUrl ?? null,
        connect_user_id: input.connectUserId ?? null,
        connect_user_email: input.connectUserEmail ?? null,
        connect_user_name: input.connectUserName ?? null,
        access_token_encrypted: input.accessTokenEncrypted ?? null,
        refresh_token_encrypted: input.refreshTokenEncrypted ?? null,
        webhook_url: input.webhookUrl ?? null,
        webhook_secret_encrypted: input.webhookSecretEncrypted ?? null,
        connected_at: input.connectedAt ?? null,
        revoked_at: input.revokedAt ?? null,
        last_error: input.lastError ?? null,
        raw_profile: input.rawProfile ? JSON.stringify(input.rawProfile) : null,
        created_at: existing?.createdAt ?? now,
        updated_at: now,
      });

    const stored = this.findBySellerUid(input.sellerUid);
    if (!stored) {
      throw new Error('Failed to persist Connect account');
    }

    return stored;
  }

  revoke(sellerUid: string, reason: string | null = null): SellerConnectAccount {
    return this.upsert({
      sellerUid,
      mode: this.findBySellerUid(sellerUid)?.mode ?? 'test',
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      lastError: reason,
    });
  }
}

export const connectRepository = new ConnectRepository();
