import { createHash } from "crypto";

import { postgresDb } from "../../server/db.js";
import {
  consumeTotpVerifiedSession,
  confirmTotpEnrollment,
  disableTotpEnrollment,
  getTotpEnrollment,
  issueTotpVerifiedSession,
  revokeTotpVerifiedSessions,
  setTotpStatus,
  upsertTotpEnrollment,
} from "./totpStore.js";

export type TotpEnrollmentRecord = NonNullable<ReturnType<typeof getTotpEnrollment>>;
export type TotpVerifiedSession = ReturnType<typeof issueTotpVerifiedSession>;

export {
  confirmTotpEnrollment,
  disableTotpEnrollment,
  getTotpEnrollment,
  revokeTotpVerifiedSessions,
  setTotpStatus,
  upsertTotpEnrollment,
};

export function createTotpVerifiedSession(userId: string): TotpVerifiedSession {
  return issueTotpVerifiedSession(userId);
}

export function getTotpEnrollmentSummary(userId: string): TotpEnrollmentRecord | null {
  return getTotpEnrollment(userId);
}

export function verifyTotpVerifiedSession(userId: string, token: string): boolean {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = postgresDb
    .prepare("SELECT user_id, expires_at FROM totp_verified_sessions WHERE token_hash = ? LIMIT 1")
    .get(tokenHash) as { user_id: string; expires_at: string } | undefined;

  return !!row && row.user_id === userId && new Date(row.expires_at).getTime() >= Date.now();
}

export function consumeVerifiedTotpSession(token: string): string | null {
  return consumeTotpVerifiedSession(token);
}
