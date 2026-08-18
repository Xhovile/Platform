/**
 * TOTP verification is now stored in an HttpOnly server cookie.
 * The browser must never read, write, or persist the session credential.
 */

export function setTotpVerifiedSessionToken(_token: string, _expiresAt?: string | null): void {
  // Kept as a compatibility no-op for older call sites during the migration.
}

export function getTotpVerifiedSessionToken(): string | null {
  return null;
}

export function getTotpVerifiedSessionExpiry(): string | null {
  return null;
}

export function clearTotpVerifiedSessionToken(): void {
  void fetch("/api/totp/session", {
    method: "DELETE",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}
