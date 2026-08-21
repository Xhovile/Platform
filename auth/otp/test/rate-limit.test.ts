import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStore, RateLimiter, fixedWindowPolicy } from "../../../rate-limit/src/index.js";
import { checkOtpRateLimit } from "../src/rate-limit.js";

test("maps OTP context into the existing rate limiter without choosing policy", async () => {
  let observedContext: Record<string, unknown> | undefined;

  const limiter = {
    check: async (context: Record<string, unknown>) => {
      observedContext = context;
      return {
        allowed: true,
        limit: 3,
        remaining: 2,
        resetAt: 123,
        retryAfterMs: 0,
        degraded: false,
      };
    },
  };

  const result = await checkOtpRateLimit(limiter, {
    operation: "issue",
    subject: "+265888000000",
    channel: "whatsapp",
    ip: "203.0.113.10",
    userId: "user-123",
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(observedContext, {
    operation: undefined,
    subject: "+265888000000",
    channel: undefined,
    ip: "203.0.113.10",
    userId: "user-123",
    route: "otp.issue.whatsapp",
  });
});

test("works with the real Platform rate limiter and leaves policy selection to the caller", async () => {
  const limiter = new RateLimiter(
    fixedWindowPolicy("otp-example", 1, 60_000, "custom", ({ subject, route }) => `${route}:${subject}`),
    new MemoryStore(),
  );

  const first = await checkOtpRateLimit(limiter, {
    operation: "issue",
    subject: "+265888000000",
    channel: "whatsapp",
  });
  const second = await checkOtpRateLimit(limiter, {
    operation: "issue",
    subject: "+265888000000",
    channel: "whatsapp",
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});
