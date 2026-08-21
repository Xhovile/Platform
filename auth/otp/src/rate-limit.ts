import type {
  RateLimitContext,
  RateLimitResult,
  RateLimiter,
} from "../../../rate-limit/src/index.js";

type OtpRateLimitOperation = "issue" | "verify";

export type OtpRateLimitContext = {
  operation: OtpRateLimitOperation;
  subject: string;
  channel: string;
  ip?: string;
  userId?: string;
};

export type OtpRateLimiter = Pick<RateLimiter, "check">;

export async function checkOtpRateLimit(
  limiter: OtpRateLimiter,
  context: OtpRateLimitContext,
): Promise<RateLimitResult> {
  const rateLimitContext: RateLimitContext = {
    ip: context.ip,
    userId: context.userId,
    subject: context.subject,
    route: `otp.${context.operation}.${context.channel}`,
  };

  return limiter.check(rateLimitContext);
}
