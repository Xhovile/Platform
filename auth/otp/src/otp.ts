import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  OtpChallenge,
  OtpIssueResult,
  OtpPolicy,
  OtpVerificationResult,
} from "./contracts.js";

export const DEFAULT_OTP_POLICY: Readonly<OtpPolicy> = {
  codeLength: 6,
  ttlMs: 5 * 60 * 1000,
  maxAttempts: 5,
};

const OTP_HASH_ALGORITHM = "sha256";
const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 9;

function validatePolicy(policy: OtpPolicy): void {
  if (
    !Number.isInteger(policy.codeLength) ||
    policy.codeLength < MIN_CODE_LENGTH ||
    policy.codeLength > MAX_CODE_LENGTH
  ) {
    throw new Error(
      `OTP code length must be an integer between ${MIN_CODE_LENGTH} and ${MAX_CODE_LENGTH}.`
    );
  }

  if (!Number.isSafeInteger(policy.ttlMs) || policy.ttlMs <= 0) {
    throw new Error("OTP TTL must be a positive safe integer in milliseconds.");
  }

  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts <= 0) {
    throw new Error("OTP max attempts must be a positive integer.");
  }
}

function normalizeSecret(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function generateOtpCode(length: number): string {
  const minimum = 10 ** (length - 1);
  const maximumExclusive = 10 ** length;
  return String(randomInt(minimum, maximumExclusive)).padStart(length, "0");
}

function hashOtpCode(code: string, salt: Buffer): string {
  return createHash(OTP_HASH_ALGORITHM)
    .update(salt)
    .update(":")
    .update(code)
    .digest("hex");
}

function codesMatch(expectedHash: string, actualHash: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function issueOtp(
  subject: string,
  channel: OtpChallenge["channel"],
  policy: OtpPolicy = DEFAULT_OTP_POLICY,
  now = new Date()
): OtpIssueResult {
  validatePolicy(policy);

  const normalizedSubject = normalizeSecret(subject, "OTP subject");
  const code = generateOtpCode(policy.codeLength);
  const salt = randomBytes(16);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + policy.ttlMs).toISOString();

  return {
    code,
    challenge: {
      id: randomUUID(),
      subject: normalizedSubject,
      channel,
      codeHash: hashOtpCode(code, salt),
      salt: salt.toString("hex"),
      createdAt,
      expiresAt,
      attempts: 0,
      maxAttempts: policy.maxAttempts,
      consumed: false,
    },
  };
}

export function verifyOtp(
  challenge: OtpChallenge,
  code: string,
  now = new Date()
): OtpVerificationResult {
  if (challenge.consumed) {
    return { ok: false, reason: "consumed", challenge };
  }

  if (now.getTime() >= new Date(challenge.expiresAt).getTime()) {
    return { ok: false, reason: "expired", challenge };
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    return { ok: false, reason: "max-attempts", challenge };
  }

  const normalizedCode = code.trim();
  const salt = Buffer.from(challenge.salt, "hex");
  const actualHash = hashOtpCode(normalizedCode, salt);

  if (!codesMatch(challenge.codeHash, actualHash)) {
    const nextChallenge: OtpChallenge = {
      ...challenge,
      attempts: challenge.attempts + 1,
    };

    return {
      ok: false,
      reason:
        nextChallenge.attempts >= nextChallenge.maxAttempts
          ? "max-attempts"
          : "invalid-code",
      challenge: nextChallenge,
    };
  }

  return {
    ok: true,
    challenge: {
      ...challenge,
      consumed: true,
    },
  };
}
