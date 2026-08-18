export const TOTP_ISSUER = "BuyMesho";
export const TOTP_ALGORITHM = "SHA1" as const;
export const TOTP_DIGITS = 6 as const;
export const TOTP_PERIOD = 30 as const;

export type TotpMfaStatus = "disabled" | "pending" | "enabled";

export type TotpEnrollmentState = {
  status: TotpMfaStatus;
  enrolledAt?: string | null;
  confirmedAt?: string | null;
  issuer?: string | null;
  accountName?: string | null;
  secretLabel?: string | null;
};

export type TotpOtpAuthParams = {
  issuer?: string;
  accountName: string;
  secret: string;
  digits?: number;
  period?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
};

export function normalizeBase32Secret(secret: string): string {
  return secret
    .trim()
    .replace(/\s+/g, "")
    .replace(/=+$/g, "")
    .toUpperCase();
}

export function normalizeTotpCode(code: string): string {
  return code.replace(/[^0-9]/g, "").slice(0, TOTP_DIGITS);
}

export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function formatTotpSecret(secret: string): string {
  const cleaned = normalizeBase32Secret(secret);
  return cleaned.match(/.{1,4}/g)?.join(" ") ?? cleaned;
}

export function buildOtpAuthUri({
  issuer = TOTP_ISSUER,
  accountName,
  secret,
  digits = TOTP_DIGITS,
  period = TOTP_PERIOD,
  algorithm = TOTP_ALGORITHM,
}: TotpOtpAuthParams): string {
  const cleanIssuer = issuer.trim();
  const cleanAccount = accountName.trim();
  const cleanSecret = normalizeBase32Secret(secret);

  if (!cleanAccount) {
    throw new Error("Account name is required to build a TOTP URI.");
  }

  if (!cleanSecret) {
    throw new Error("A TOTP secret is required to build an otpauth URI.");
  }

  const label = `${cleanIssuer}:${cleanAccount}`;
  const query = new URLSearchParams({
    secret: cleanSecret,
    issuer: cleanIssuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function getTotpDisplayName(
  businessName?: string | null,
  email?: string | null
): string {
  const trimmedBusinessName = businessName?.trim();
  if (trimmedBusinessName) return trimmedBusinessName;

  const trimmedEmail = email?.trim();
  if (trimmedEmail) return trimmedEmail;

  return "BuyMesho account";
}

export function canEnableTotp(status: TotpMfaStatus): boolean {
  return status !== "enabled";
}

export function canDisableTotp(status: TotpMfaStatus): boolean {
  return status === "enabled" || status === "pending";
}
