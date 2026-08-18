import {
  buildTotpRecord,
  getIssuerLabel,
  type TotpEnrollmentRecord,
} from "./totpService.js";
import { postgresDb } from "../../server/db.js";
import { createHash, randomBytes } from "crypto";
import type { TotpMfaStatus } from "../lib/totp.js";

const TOTP_VERIFIED_SESSION_TTL_MS = 15 * 60 * 1000;
const verifiedSessionDb = postgresDb;
let totpTablesEnsured = false;

function ensureTotpTables(): void {
  if (totpTablesEnsured) return;

  verifiedSessionDb.exec(`
    CREATE TABLE IF NOT EXISTS totp_enrollments (
      user_id TEXT PRIMARY KEY,
      email TEXT,
      status TEXT NOT NULL,
      secret TEXT NOT NULL,
      issuer TEXT NOT NULL,
      account_name TEXT NOT NULL,
      enrolled_at TEXT NOT NULL,
      confirmed_at TEXT
    )
  `);

  verifiedSessionDb.exec(`
    CREATE TABLE IF NOT EXISTS totp_verified_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  totpTablesEnsured = true;
}

export type TotpEnrollmentInput = {
  userId: string;
  email?: string | null;
  secret: string;
  issuer?: string;
  accountName?: string;
};

export type TotpEnrollmentSummary = {
  userId: string;
  email: string | null;
  status: TotpMfaStatus;
  issuer: string;
  accountName: string;
  enrolledAt: string | null;
  confirmedAt: string | null;
};

export type TotpVerifiedSession = {
  token: string;
  userId: string;
  expiresAt: string;
};

export function getTotpEnrollment(userId: string): TotpEnrollmentRecord | null {
  ensureTotpTables();

  const row = verifiedSessionDb
    .prepare(
      `
      SELECT user_id, email, status, secret, issuer, account_name, enrolled_at, confirmed_at
      FROM totp_enrollments
      WHERE user_id = ?
      `
    )
    .get(userId) as
    | {
        user_id: string;
        email: string | null;
        status: TotpMfaStatus;
        secret: string;
        issuer: string;
        account_name: string;
        enrolled_at: string;
        confirmed_at: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    status: row.status,
    secret: row.secret,
    issuer: row.issuer,
    accountName: row.account_name,
    enrolledAt: row.enrolled_at,
    confirmedAt: row.confirmed_at,
  };
}

export function listTotpEnrollments(): TotpEnrollmentRecord[] {
  ensureTotpTables();

  const rows = verifiedSessionDb
    .prepare(
      `
      SELECT user_id, email, status, secret, issuer, account_name, enrolled_at, confirmed_at
      FROM totp_enrollments
      ORDER BY enrolled_at DESC
      `
    )
    .all() as Array<{
    user_id: string;
    email: string | null;
    status: TotpMfaStatus;
    secret: string;
    issuer: string;
    account_name: string;
    enrolled_at: string;
    confirmed_at: string | null;
  }>;

  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    status: row.status,
    secret: row.secret,
    issuer: row.issuer,
    accountName: row.account_name,
    enrolledAt: row.enrolled_at,
    confirmedAt: row.confirmed_at,
  }));
}

export function upsertTotpEnrollment(input: TotpEnrollmentInput): TotpEnrollmentRecord {
  ensureTotpTables();

  const existing = getTotpEnrollment(input.userId);
  const next = existing
    ? {
        ...existing,
        email: input.email ?? existing.email,
        secret: input.secret,
        issuer: input.issuer ? getIssuerLabel(input.issuer) : existing.issuer,
        accountName: input.accountName?.trim() || existing.accountName,
      }
    : buildTotpRecord({
        userId: input.userId,
        email: input.email ?? null,
        secret: input.secret,
        issuer: input.issuer,
        accountName: input.accountName,
      });

  verifiedSessionDb
    .prepare(
      `
      INSERT INTO totp_enrollments (
        user_id,
        email,
        status,
        secret,
        issuer,
        account_name,
        enrolled_at,
        confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email,
        status = excluded.status,
        secret = excluded.secret,
        issuer = excluded.issuer,
        account_name = excluded.account_name,
        enrolled_at = excluded.enrolled_at,
        confirmed_at = excluded.confirmed_at
      `
    )
    .run(
      next.userId,
      next.email,
      next.status,
      next.secret,
      next.issuer,
      next.accountName,
      next.enrolledAt,
      next.confirmedAt
    );

  return next;
}

export function confirmTotpEnrollment(userId: string): TotpEnrollmentRecord | null {
  ensureTotpTables();

  const existing = getTotpEnrollment(userId);
  if (!existing) return null;

  const confirmed: TotpEnrollmentRecord = {
    ...existing,
    status: "enabled",
    confirmedAt: new Date().toISOString(),
  };

  verifiedSessionDb
    .prepare("UPDATE totp_enrollments SET status = ?, confirmed_at = ? WHERE user_id = ?")
    .run(confirmed.status, confirmed.confirmedAt, userId);

  return confirmed;
}

export function disableTotpEnrollment(userId: string): boolean {
  ensureTotpTables();

  const clearEnrollment = verifiedSessionDb.prepare("DELETE FROM totp_enrollments WHERE user_id = ?");
  const clearVerifiedSessions = verifiedSessionDb.prepare("DELETE FROM totp_verified_sessions WHERE user_id = ?");

  const result = verifiedSessionDb.transaction((uid: string) => {
    const enrollmentResult = clearEnrollment.run(uid);
    clearVerifiedSessions.run(uid);
    return enrollmentResult;
  })(userId);

  return result.changes > 0;
}

export function revokeTotpVerifiedSessions(userId: string): void {
  ensureTotpTables();
  verifiedSessionDb.prepare("DELETE FROM totp_verified_sessions WHERE user_id = ?").run(userId);
}

export function setTotpStatus(userId: string, status: TotpMfaStatus): TotpEnrollmentRecord | null {
  ensureTotpTables();

  const existing = getTotpEnrollment(userId);
  if (!existing) return null;

  const next: TotpEnrollmentRecord = { ...existing, status };
  verifiedSessionDb
    .prepare("UPDATE totp_enrollments SET status = ? WHERE user_id = ?")
    .run(status, userId);

  return next;
}

export function issueTotpVerifiedSession(userId: string): TotpVerifiedSession {
  ensureTotpTables();

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + TOTP_VERIFIED_SESSION_TTL_MS).toISOString();

  verifiedSessionDb
    .prepare(
      `INSERT INTO totp_verified_sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, ?)`
    )
    .run(tokenHash, userId, expiresAt);

  return { token, userId, expiresAt };
}

export function consumeTotpVerifiedSession(token: string): string | null {
  ensureTotpTables();

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = verifiedSessionDb
    .prepare("SELECT user_id, expires_at FROM totp_verified_sessions WHERE token_hash = ? LIMIT 1")
    .get(tokenHash) as { user_id: string; expires_at: string } | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    verifiedSessionDb.prepare("DELETE FROM totp_verified_sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  verifiedSessionDb.prepare("DELETE FROM totp_verified_sessions WHERE token_hash = ?").run(tokenHash);
  return row.user_id;
}
