export const OTP_CHANNELS = ["sms", "whatsapp", "email"] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export type OtpPolicy = {
  codeLength: number;
  ttlMs: number;
  maxAttempts: number;
};

export type OtpChallenge = {
  id: string;
  subject: string;
  channel: OtpChannel;
  codeHash: string;
  salt: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
};

export type OtpIssueResult = {
  challenge: OtpChallenge;
  code: string;
};

export type OtpVerificationReason =
  | "invalid-code"
  | "expired"
  | "max-attempts"
  | "consumed";

export type OtpVerificationResult =
  | {
      ok: true;
      challenge: OtpChallenge;
    }
  | {
      ok: false;
      reason: OtpVerificationReason;
      challenge: OtpChallenge;
    };
