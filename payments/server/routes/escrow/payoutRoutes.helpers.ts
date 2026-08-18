import type express from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'crypto';
import { getPaymentDb } from '../../postgresCompat.js';
import { type AdminOverrideAction, canApprovePayoutOverride, canEditPayoutSettings, canRequestPayoutRetry, canRequestWithdrawal, canViewPayoutHistory, canViewPayoutSettings, type PayoutPermissionActor } from '../../modules/payouts/payout.service.js';
import { PAYOUT_POLICY, isRetryableFailureCode } from '../../modules/payouts/payout.policy.js';
import { getRequestUser } from './shared.js';

export const DEFAULT_CURRENCY = 'MWK';
const PAYOUT_ENCRYPTION_SECRET = process.env.SELLER_PAYOUT_ENCRYPTION_KEY ?? '';

export type DestinationType = 'mobile_money' | 'bank';

export type SellerPayoutDestinationRow = {
  id: string;
  seller_uid: string;
  destination_type: DestinationType;
  provider_name: string;
  provider_ref_id: string | null;
  currency: string;
  account_name: string;
  account_number_encrypted: string | null;
  mobile_encrypted: string | null;
  masked_account: string;
  destination_fingerprint: string;
  is_default: number;
  verification_status: string;
  verification_attempts: number;
  last_error: string | null;
  verified_at: string | null;
  replaced_from_id: string | null;
  replaced_by_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type SellerPayoutDestinationRecord = {
  id: string;
  sellerId: string;
  destinationType: DestinationType;
  providerName: string;
  providerRefId: string | null;
  currency: string;
  accountName: string;
  maskedAccount: string;
  isDefault: boolean;
  verificationStatus: string;
  verificationAttempts: number;
  lastError: string | null;
  verifiedAt: string | null;
  replacedFromId: string | null;
  replacedById: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SellerPayoutPermissions = {
  viewPayoutSettings: boolean;
  editPayoutSettings: boolean;
  requestWithdrawal: boolean;
  viewPayoutHistory: boolean;
  requestPayoutRetry: boolean;
  approveOverride: boolean;
};

export type NormalizedMobileMoneyOperator = { refId: string; name: string };
export type NormalizedPayoutBank = { uuid: string; name: string };

export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function normalizeOverrideAction(value: unknown): AdminOverrideAction {
  const action = normalizeText(value)?.toLowerCase();
  if (action === 'hold' || action === 'mark_paid' || action === 'mark_failed' || action === 'cancel') {
    return action;
  }
  throw new Error('action must be one of: hold, mark_paid, mark_failed, cancel');
}

export function normalizeCurrency(value: unknown): string {
  const currency = normalizeText(value)?.toUpperCase() ?? DEFAULT_CURRENCY;
  if (currency !== DEFAULT_CURRENCY) {
    throw new Error('Only MWK payout destinations are supported right now');
  }
  return currency;
}

export function normalizeProviderCurrency(value: unknown): string {
  const currency = normalizeText(value)?.toUpperCase() ?? DEFAULT_CURRENCY;
  if (currency !== DEFAULT_CURRENCY) {
    throw new Error('Only MWK payout provider lookups are supported right now');
  }
  return currency;
}

export function normalizeDestinationType(value: unknown): DestinationType {
  const type = normalizeText(value)?.toLowerCase();
  if (type === 'mobile_money' || type === 'bank') return type;
  throw new Error('destinationType must be mobile_money or bank');
}

export function normalizeProviderName(value: unknown): string {
  const providerName = normalizeText(value);
  if (!providerName) throw new Error('providerName is required');
  return providerName;
}

export function normalizeAccountName(value: unknown): string {
  const accountName = normalizeText(value);
  if (!accountName) throw new Error('accountName is required');
  return accountName;
}

export function normalizeProviderRefId(value: unknown): string | null {
  return normalizeText(value);
}

export function normalizeDestinationValue(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function normalizeDestinationId(value: unknown): string {
  const id = normalizeText(value);
  if (!id) throw new Error('Destination id is required');
  return id;
}

export function normalizeManualPayoutAmount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isInteger(numeric)) {
    throw new Error('amount must be a positive integer');
  }
  return numeric;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

export function maskValue(value: string): string {
  const clean = onlyDigits(value);
  if (!clean) return '****';
  if (clean.length <= 4) return `****${clean}`;
  return `****${clean.slice(-4)}`;
}

export function requirePayoutEncryptionSecret(): string {
  if (!PAYOUT_ENCRYPTION_SECRET) {
    throw new Error('SELLER_PAYOUT_ENCRYPTION_KEY is not configured');
  }
  return PAYOUT_ENCRYPTION_SECRET;
}

export function getDerivedEncryptionKey(): Buffer {
  const secret = requirePayoutEncryptionSecret();
  return scryptSync(secret, 'BuyMesho seller payout', 32);
}

export function encryptSensitiveValue(value: string): string {
  const key = getDerivedEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSensitiveValue(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length !== 3) return value;

  try {
    const key = getDerivedEncryptionKey();
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return `${decipher.update(encrypted, undefined, 'utf8')}${decipher.final('utf8')}`;
  } catch {
    return null;
  }
}

export function normalizeAccountNumber(value: unknown): string {
  return onlyDigits(normalizeDestinationValue(value, 'accountNumber'));
}

export function formatPayChanguMobile(value: unknown, targetEndpoint: 'momo' | 'bank_payout_momo' = 'momo'): string {
  const raw = normalizeDestinationValue(value, 'mobile');
  const digits = onlyDigits(raw);

  let local: string;
  if (digits.length === 10 && digits.startsWith('0')) {
    local = digits;
  } else if (digits.length === 12 && digits.startsWith('265')) {
    local = `0${digits.slice(3)}`;
  } else if (digits.length === 9) {
    local = `0${digits}`;
  } else {
    throw new Error('mobile must be a valid Malawi number');
  }

  if (local.length !== 10 || !local.startsWith('0')) {
    throw new Error('mobile must be a valid Malawi number');
  }

  return targetEndpoint === 'bank_payout_momo' ? `265${local.slice(1)}` : local;
}

export function normalizeMobileNumber(value: unknown): string {
  return formatPayChanguMobile(value, 'bank_payout_momo');
}

export function buildDestinationFingerprint(input: {
  sellerId: string;
  destinationType: DestinationType;
  providerName: string;
  providerRefId: string | null;
  currency: string;
  targetValue: string;
}): string {
  return createHash('sha256')
    .update([input.sellerId, input.destinationType, input.providerName.toLowerCase(), input.providerRefId?.toLowerCase() ?? '', input.currency.toUpperCase(), input.targetValue].join('|'))
    .digest('hex');
}

export function rowToSellerPayoutDestination(row: SellerPayoutDestinationRow): SellerPayoutDestinationRecord {
  return {
    id: row.id,
    sellerId: row.seller_uid,
    destinationType: row.destination_type,
    providerName: row.provider_name,
    providerRefId: row.provider_ref_id,
    currency: row.currency,
    accountName: row.account_name,
    maskedAccount: row.masked_account,
    isDefault: row.is_default === 1,
    verificationStatus: row.verification_status,
    verificationAttempts: row.verification_attempts,
    lastError: row.last_error,
    verifiedAt: row.verified_at,
    replacedFromId: row.replaced_from_id,
    replacedById: row.replaced_by_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getActor(req: express.Request): PayoutPermissionActor | null {
  const user = getRequestUser(req);
  return user ? { uid: user.uid, is_admin: user.is_admin } : null;
}

export function buildPermissions(sellerId: string, actor: PayoutPermissionActor | null): SellerPayoutPermissions {
  const context = { sellerId, actor };
  return {
    viewPayoutSettings: canViewPayoutSettings(context),
    editPayoutSettings: canEditPayoutSettings(context),
    requestWithdrawal: canRequestWithdrawal(context),
    viewPayoutHistory: canViewPayoutHistory(context),
    requestPayoutRetry: canRequestPayoutRetry(context),
    approveOverride: canApprovePayoutOverride(context),
  };
}

export function assertAllowed(req: express.Request, allowed: boolean, message: string): void {
  if (!allowed) {
    const user = getRequestUser(req);
    if (!user) throw new Error('Unauthorized');
    throw new Error(message);
  }
}

export function assertViewSettingsAccess(req: express.Request, sellerId: string): void {
  assertAllowed(req, canViewPayoutSettings({ actor: getActor(req), sellerId }), 'You are not allowed to view this payout setting');
}

export function assertProviderLookupAccess(req: express.Request): string {
  const sellerId = getRequestSellerId(req, req.query.sellerUid);
  assertViewSettingsAccess(req, sellerId);
  return sellerId;
}

export function normalizeMobileMoneyProviderRecords(records: Array<{ refId: string; name: string }>): NormalizedMobileMoneyOperator[] {
  return records.map((record) => ({ refId: record.refId, name: record.name }));
}

export function normalizeBankProviderRecords(records: Array<{ uuid: string; name: string }>): NormalizedPayoutBank[] {
  return records.map((record) => ({ uuid: record.uuid, name: record.name }));
}

export function assertEditSettingsAccess(req: express.Request, sellerId: string): void {
  assertAllowed(req, canEditPayoutSettings({ actor: getActor(req), sellerId }), 'You are not allowed to edit this payout setting');
}

export function assertWithdrawalAccess(req: express.Request, sellerId: string): void {
  assertAllowed(req, canRequestWithdrawal({ actor: getActor(req), sellerId }), 'You are not allowed to request withdrawal for this seller');
}

export function assertHistoryAccess(req: express.Request, sellerId: string): void {
  assertAllowed(req, canViewPayoutHistory({ actor: getActor(req), sellerId }), 'You are not allowed to view this payout history');
}

export function assertRetryAccess(req: express.Request, sellerId: string): void {
  assertAllowed(req, canRequestPayoutRetry({ actor: getActor(req), sellerId }), 'You are not allowed to trigger payout retry');
}

export function assertOverrideAccess(req: express.Request): void {
  const actor = getActor(req);
  assertAllowed(req, canApprovePayoutOverride({ actor, sellerId: actor?.uid ?? '' }), 'Admin approval required');
}

export function findDestinationById(destinationId: string): SellerPayoutDestinationRow | undefined {
  const db = getPaymentDb();
  return db.prepare('SELECT * FROM seller_payout_accounts WHERE id = ? LIMIT 1').get(destinationId) as SellerPayoutDestinationRow | undefined;
}

export function findDestinationDuplicate(sellerId: string, fingerprint: string, excludeId?: string): SellerPayoutDestinationRow | undefined {
  const db = getPaymentDb();
  const query = excludeId
    ? `SELECT * FROM seller_payout_accounts
       WHERE seller_uid = ?
         AND destination_fingerprint = ?
         AND id <> ?
       LIMIT 1`
    : `SELECT * FROM seller_payout_accounts
       WHERE seller_uid = ?
         AND destination_fingerprint = ?
       LIMIT 1`;

  return (excludeId ? db.prepare(query).get(sellerId, fingerprint, excludeId) : db.prepare(query).get(sellerId, fingerprint)) as SellerPayoutDestinationRow | undefined;
}

export function listSellerDestinations(sellerId: string): SellerPayoutDestinationRecord[] {
  const db = getPaymentDb();
  const rows = db.prepare(
    `SELECT * FROM seller_payout_accounts
     WHERE seller_uid = ?
     ORDER BY is_default DESC, created_at DESC`,
  ).all(sellerId) as SellerPayoutDestinationRow[];
  return rows.map(rowToSellerPayoutDestination);
}

export function listSellerPayoutOperationalView(sellerId: string) {
  const db = getPaymentDb();
  const rows = db.prepare(
    `SELECT
       p.id,
       p.seller_id,
       p.order_id,
       p.escrow_id,
       p.release_entry_id,
       p.amount,
       p.currency,
       p.gross_amount,
       p.platform_fee_amount,
       p.reserve_amount,
       p.manual_adjustment_amount,
       p.payout_fee_amount,
       p.seller_receives_amount,
       p.net_amount,
       p.status,
       p.provider,
       p.provider_charge_id,
       p.provider_status,
       p.failure_reason,
       p.manual_review_reason,
       p.requested_by,
       p.requested_at,
       p.created_at,
       p.updated_at,
       spa.verification_status AS destination_verification_status,
       spa.is_active AS destination_is_active,
       (
         SELECT COALESCE(MAX(attempt_no), 0)
         FROM payout_attempts pa
         WHERE pa.payout_id = p.id
       ) AS retry_count
     FROM payouts p
     LEFT JOIN seller_payout_accounts spa ON spa.id = p.destination_account_id
     WHERE p.seller_id = ?
     ORDER BY p.created_at DESC`,
  ).all(sellerId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const status = String(row.status ?? 'pending').toLowerCase();
    const destinationStatus = String(row.destination_verification_status ?? 'missing').toLowerCase();
    const failureReason = (row.failure_reason as string | null) ?? null;
    const manualReviewReason = (row.manual_review_reason as string | null) ?? null;
    const retryCount = Number(row.retry_count ?? 0);
    const verificationBlockers: string[] = [];

    if (destinationStatus === 'missing') verificationBlockers.push('Update destination to continue');
    else if (destinationStatus === 'failed') verificationBlockers.push('Destination verification failed');
    else if (destinationStatus === 'disabled' || Number(row.destination_is_active ?? 0) !== 1) verificationBlockers.push('Destination is disabled');
    else if (destinationStatus !== 'verified') verificationBlockers.push('Destination pending verification');

    const retryAllowed = status === 'failed' && retryCount < PAYOUT_POLICY.maxRetryCount && isRetryableFailureCode(failureReason);

    return {
      id: row.id,
      sellerId: row.seller_id,
      orderId: row.order_id,
      escrowId: row.escrow_id,
      releaseEntryId: row.release_entry_id,
      amount: row.amount,
      currency: row.currency,
      grossAmount: row.gross_amount,
      platformFeeAmount: row.platform_fee_amount,
      reserveAmount: row.reserve_amount,
      manualAdjustmentAmount: row.manual_adjustment_amount,
      payoutFeeAmount: row.payout_fee_amount,
      sellerReceivesAmount: row.seller_receives_amount,
      netAmount: row.net_amount,
      status,
      provider: row.provider,
      providerChargeId: row.provider_charge_id,
      providerStatus: row.provider_status,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      destinationStatus,
      holdReason: status === 'held' ? manualReviewReason : null,
      lastFailureReason: failureReason,
      retryAllowed,
      retryCount,
      manualReviewPending: status === 'held' || !!manualReviewReason,
      verificationBlockers,
      lastUpdatedTimestamp: row.updated_at,
    };
  });
}

function isUniqueFingerprintViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; constraint?: unknown; message?: unknown };
  return (
    record.code === '23505' &&
    (record.constraint === 'idx_seller_payout_accounts_destination_fingerprint' ||
      String(record.message ?? '').includes('idx_seller_payout_accounts_destination_fingerprint'))
  );
}

function buildDestinationDuplicateMessage(existing: SellerPayoutDestinationRow | undefined): string {
  if (!existing) {
    return 'That payout destination already exists for this seller';
  }

  const status = existing.verification_status?.toLowerCase() ?? 'pending';
  if (existing.is_active === 1 && status === 'verified') {
    return 'That payout destination already exists and is already verified';
  }

  return 'That payout destination already exists for this seller';
}

function normalizeDuplicateFingerprintRow(existing: SellerPayoutDestinationRow, input: {
  destinationType: DestinationType;
  providerName: string;
  providerRefId: string | null;
  currency: string;
  accountName: string;
  accountNumber?: string | null;
  mobile?: string | null;
  isDefault: boolean;
  sourceId?: string | null;
}): SellerPayoutDestinationRecord {
  const db = getPaymentDb();
  const now = new Date().toISOString();
  const isDefault = input.isDefault || existing.is_default === 1;
  const targetValue = input.destinationType === 'bank'
    ? normalizeAccountNumber(input.accountNumber ?? decryptSensitiveValue(existing.account_number_encrypted) ?? '')
    : normalizeMobileNumber(input.mobile ?? decryptSensitiveValue(existing.mobile_encrypted) ?? '');
  const fingerprint = buildDestinationFingerprint({
    sellerId: existing.seller_uid,
    destinationType: input.destinationType,
    providerName: input.providerName,
    providerRefId: input.providerRefId,
    currency: input.currency,
    targetValue,
  });
  const accountNumberEncrypted = input.destinationType === 'bank' ? encryptSensitiveValue(normalizeAccountNumber(input.accountNumber ?? decryptSensitiveValue(existing.account_number_encrypted) ?? '')) : null;
  const mobileEncrypted = input.destinationType === 'mobile_money' ? encryptSensitiveValue(normalizeMobileNumber(input.mobile ?? decryptSensitiveValue(existing.mobile_encrypted) ?? '')) : null;
  const maskedAccount = input.destinationType === 'bank'
    ? maskValue(normalizeAccountNumber(input.accountNumber ?? decryptSensitiveValue(existing.account_number_encrypted) ?? ''))
    : maskValue(normalizeMobileNumber(input.mobile ?? decryptSensitiveValue(existing.mobile_encrypted) ?? ''));

  db.transaction(() => {
    if (isDefault) {
      db.prepare('UPDATE seller_payout_accounts SET is_default = 0, updated_at = ? WHERE seller_uid = ? AND id <> ?').run(now, existing.seller_uid, existing.id);
    }

    db.prepare(`
      UPDATE seller_payout_accounts
      SET destination_type = ?,
          provider_name = ?,
          provider_ref_id = ?,
          currency = ?,
          account_name = ?,
          account_number_encrypted = ?,
          mobile_encrypted = ?,
          masked_account = ?,
          destination_fingerprint = ?,
          is_default = ?,
          verification_status = 'pending',
          verification_attempts = 0,
          last_error = NULL,
          verified_at = NULL,
          replaced_from_id = ?,
          replaced_by_id = NULL,
          is_active = 1,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.destinationType,
      input.providerName,
      input.providerRefId,
      input.currency,
      input.accountName,
      accountNumberEncrypted,
      mobileEncrypted,
      maskedAccount,
      fingerprint,
      isDefault ? 1 : 0,
      input.sourceId ?? existing.replaced_from_id ?? null,
      now,
      existing.id,
    );
  })();

  const updated = findDestinationById(existing.id);
  if (!updated) throw new Error('Failed to revive payout destination');
  return rowToSellerPayoutDestination(updated);
}

export function addDestinationEvent(input: { sellerId: string; accountId: string; eventType: string; actorType: 'seller' | 'admin' | 'system'; actorId?: string | null; note?: string | null; payload?: Record<string, unknown> | null; }): void {
  const db = getPaymentDb();
  db.prepare(
    `INSERT INTO seller_payout_account_events (
      seller_uid,
      account_id,
      event_type,
      actor_type,
      actor_id,
      note,
      payload,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.sellerId, input.accountId, input.eventType, input.actorType, input.actorId ?? null, input.note ?? null, input.payload ? JSON.stringify(input.payload) : null, new Date().toISOString());
}

export function createDestinationRecord(input: { sellerId: string; destinationType: DestinationType; providerName: string; providerRefId: string | null; currency: string; accountName: string; accountNumber?: string | null; mobile?: string | null; isDefault: boolean; sourceId?: string | null; }): SellerPayoutDestinationRecord {
  const db = getPaymentDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const targetValue = input.destinationType === 'bank' ? normalizeAccountNumber(input.accountNumber ?? '') : normalizeMobileNumber(input.mobile ?? '');
  const fingerprint = buildDestinationFingerprint({ sellerId: input.sellerId, destinationType: input.destinationType, providerName: input.providerName, providerRefId: input.providerRefId, currency: input.currency, targetValue });

  const duplicate = findDestinationDuplicate(input.sellerId, fingerprint);
  if (duplicate) {
    return normalizeDuplicateFingerprintRow(duplicate, input);
  }

  const accountNumberEncrypted = input.destinationType === 'bank' ? encryptSensitiveValue(normalizeAccountNumber(input.accountNumber ?? '')) : null;
  const mobileEncrypted = input.destinationType === 'mobile_money' ? encryptSensitiveValue(normalizeMobileNumber(input.mobile ?? '')) : null;
  const maskedAccount = input.destinationType === 'bank' ? maskValue(normalizeAccountNumber(input.accountNumber ?? '')) : maskValue(normalizeMobileNumber(input.mobile ?? ''));

  try {
    db.transaction(() => {
      if (input.isDefault) {
        db.prepare(`UPDATE seller_payout_accounts SET is_default = 0, updated_at = ? WHERE seller_uid = ?`).run(now, input.sellerId);
      }

      db.prepare(
        `INSERT INTO seller_payout_accounts (
          id,
          seller_uid,
          destination_type,
          provider_name,
          provider_ref_id,
          currency,
          account_name,
          account_number_encrypted,
          mobile_encrypted,
          masked_account,
          destination_fingerprint,
          is_default,
          verification_status,
          verification_attempts,
          last_error,
          verified_at,
          replaced_from_id,
          replaced_by_id,
          is_active,
          created_at,
        updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, NULL, 1, ?, ?)`,
      ).run(id, input.sellerId, input.destinationType, input.providerName, input.providerRefId, input.currency, input.accountName, accountNumberEncrypted, mobileEncrypted, maskedAccount, fingerprint, input.isDefault ? 1 : 0, input.sourceId ?? null, now, now);
    })();
  } catch (error) {
    if (isUniqueFingerprintViolation(error)) {
      const existing = findDestinationDuplicate(input.sellerId, fingerprint);
      if (existing) return normalizeDuplicateFingerprintRow(existing, input);
      throw new Error(buildDestinationDuplicateMessage(existing));
    }
    throw error;
  }

  const created = findDestinationById(id);
  if (!created) throw new Error('Failed to create payout destination');
  return rowToSellerPayoutDestination(created);
}

export function updateDestinationRecord(existing: SellerPayoutDestinationRow, updates: { destinationType?: DestinationType; providerName?: string; providerRefId?: string | null; currency?: string; accountName?: string; accountNumber?: string | null; mobile?: string | null; isDefault?: boolean; }): SellerPayoutDestinationRecord {
  const db = getPaymentDb();
  const now = new Date().toISOString();

  const destinationType = updates.destinationType ?? existing.destination_type;
  const providerName = updates.providerName ?? existing.provider_name;
  const providerRefId = updates.providerRefId ?? existing.provider_ref_id;
  const currency = updates.currency ?? existing.currency;
  const accountName = updates.accountName ?? existing.account_name;
  const accountNumber = destinationType === 'bank' ? (updates.accountNumber ?? decryptSensitiveValue(existing.account_number_encrypted) ?? '') : null;
  const mobile = destinationType === 'mobile_money' ? (updates.mobile ?? decryptSensitiveValue(existing.mobile_encrypted) ?? '') : null;
  const targetValue = destinationType === 'bank' ? normalizeAccountNumber(accountNumber) : normalizeMobileNumber(mobile);
  const fingerprint = buildDestinationFingerprint({ sellerId: existing.seller_uid, destinationType, providerName, providerRefId, currency, targetValue });

  const duplicate = findDestinationDuplicate(existing.seller_uid, fingerprint, existing.id);
  if (duplicate) {
    return rowToSellerPayoutDestination(duplicate.id === existing.id ? existing : duplicate);
  }

  const accountNumberEncrypted = destinationType === 'bank' ? encryptSensitiveValue(normalizeAccountNumber(accountNumber)) : null;
  const mobileEncrypted = destinationType === 'mobile_money' ? encryptSensitiveValue(normalizeMobileNumber(mobile)) : null;
  const maskedAccount = destinationType === 'bank' ? maskValue(normalizeAccountNumber(accountNumber)) : maskValue(normalizeMobileNumber(mobile));
  const isDefault = updates.isDefault ?? existing.is_default === 1;
  const shouldResetVerification = fingerprint !== existing.destination_fingerprint;

  try {
    db.transaction(() => {
      if (isDefault) {
        db.prepare('UPDATE seller_payout_accounts SET is_default = 0, updated_at = ? WHERE seller_uid = ? AND id <> ?').run(now, existing.seller_uid, existing.id);
      }

      db.prepare(
        `UPDATE seller_payout_accounts
         SET destination_type = ?,
             provider_name = ?,
             provider_ref_id = ?,
             currency = ?,
             account_name = ?,
             account_number_encrypted = ?,
             mobile_encrypted = ?,
             masked_account = ?,
             destination_fingerprint = ?,
             is_default = ?,
             verification_status = ?,
             verification_attempts = ?,
             last_error = ?,
             verified_at = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(destinationType, providerName, providerRefId, currency, accountName, accountNumberEncrypted, mobileEncrypted, maskedAccount, fingerprint, isDefault ? 1 : 0, shouldResetVerification ? 'pending' : existing.verification_status, shouldResetVerification ? 0 : existing.verification_attempts, shouldResetVerification ? null : existing.last_error, shouldResetVerification ? null : existing.verified_at, now, existing.id);
    })();
  } catch (error) {
    if (isUniqueFingerprintViolation(error)) {
      const duplicate = findDestinationDuplicate(existing.seller_uid, fingerprint, existing.id);
      if (duplicate) return rowToSellerPayoutDestination(duplicate);
      throw new Error(buildDestinationDuplicateMessage(duplicate));
    }
    throw error;
  }

  const updated = findDestinationById(existing.id);
  if (!updated) throw new Error('Failed to update payout destination');
  return rowToSellerPayoutDestination(updated);
}

export function getRequestSellerId(req: express.Request, sellerUid?: unknown): string {
  const user = getRequestUser(req);
  if (!user) throw new Error('Unauthorized');
  if (user.is_admin && typeof sellerUid === 'string' && sellerUid.trim()) {
    return sellerUid.trim();
  }
  return user.uid;
}
