import crypto from "crypto";
import {
  TOTP_ALGORITHM,
  TOTP_DIGITS,
  TOTP_PERIOD,
  TOTP_ISSUER,
  normalizeBase32Secret,
  normalizeTotpCode,
  isValidTotpCode,
  type TotpMfaStatus,
} from "../lib/totp.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type TotpChallengePayload = {
  userId: string;
  email?: string | null;
  issuer?: string;
  secret: string;
  period?: number;
  digits?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
};

export type TotpEnrollmentRecord = {
  userId: string;
  email: string | null;
  status: TotpMfaStatus;
  secret: string;
  issuer: string;
  accountName: string;
  confirmedAt: string | null;
  enrolledAt: string;
};

export type TotpVerificationResult = {
  ok: true;
  counter: number;
} | {
  ok: false;
  reason: "invalid_code" | "invalid_secret" | "clock_skew";
};

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  return base32Encode(bytes);
}

export function buildTotpRecord(input: {
  userId: string;
  email?: string | null;
  secret: string;
  issuer?: string;
  accountName?: string;
}): TotpEnrollmentRecord {
  const issuer = (input.issuer || TOTP_ISSUER).trim();
  const accountName = (input.accountName || input.email || input.userId).trim();

  return {
    userId: input.userId,
    email: input.email || null,
    status: "pending",
    secret: normalizeBase32Secret(input.secret),
    issuer,
    accountName,
    confirmedAt: null,
    enrolledAt: new Date().toISOString(),
  };
}

export function getTotpCounter(time = Date.now(), period: number = TOTP_PERIOD): number {
  return Math.floor(time / 1000 / period);
}

export function generateTotpCode(
  secret: string,
  counter = getTotpCounter(),
  digits: number = TOTP_DIGITS,
  algorithm: "SHA1" | "SHA256" | "SHA512" = TOTP_ALGORITHM
): string {
  const key = base32Decode(normalizeBase32Secret(secret));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algorithm.toLowerCase(), key);
  hmac.update(buffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, "0");
}

export function verifyTotpCode({
  secret,
  code,
  time = Date.now(),
  period = TOTP_PERIOD,
  digits = TOTP_DIGITS,
  algorithm = TOTP_ALGORITHM,
  window = 1,
}: {
  secret: string;
  code: string;
  time?: number;
  period?: number;
  digits?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
  window?: number;
}): TotpVerificationResult {
  const normalizedCode = normalizeTotpCode(code);

  if (!isValidTotpCode(normalizedCode)) {
    return { ok: false, reason: "invalid_code" };
  }

  const normalizedSecret = normalizeBase32Secret(secret);
  if (!normalizedSecret) {
    return { ok: false, reason: "invalid_secret" };
  }

  const currentCounter = getTotpCounter(time, period);

  for (let offset = -window; offset <= window; offset += 1) {
    const counter = currentCounter + offset;
    const candidate = generateTotpCode(normalizedSecret, counter, digits, algorithm);
    if (candidate === normalizedCode) {
      return { ok: true, counter };
    }
  }

  return { ok: false, reason: "clock_skew" };
}

export function buildOtpAuthUri(input: {
  issuer: string;
  accountName: string;
  secret: string;
  digits?: number;
  period?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
}): string {
  const issuer = input.issuer.trim();
  const accountName = input.accountName.trim();
  const secret = normalizeBase32Secret(input.secret);
  const digits = input.digits ?? TOTP_DIGITS;
  const period = input.period ?? TOTP_PERIOD;
  const algorithm = input.algorithm ?? TOTP_ALGORITHM;

  const label = `${issuer}:${accountName}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    digits: String(digits),
    period: String(period),
    algorithm,
  });

  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function getIssuerLabel(issuer?: string | null): string {
  return (issuer || TOTP_ISSUER).trim() || TOTP_ISSUER;
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = normalizeBase32Secret(value).replace(/=+$/g, "");
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;

    current = (current << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
