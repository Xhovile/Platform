import type {
  RateLimitKeyResolver,
  RateLimitKeyStrategy,
  RateLimitPolicy,
} from './contracts.js';

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

export type FixedWindowPolicyOptions = {
  name: string;
  limit: number;
  windowMs: number;
  key: RateLimitKeyStrategy;
  keyResolver?: RateLimitKeyResolver;
};

export function fixedWindowPolicy(
  options: FixedWindowPolicyOptions,
): RateLimitPolicy {
  return { ...options };
}

export function perMinutePolicy(
  name: string,
  limit: number,
  key: RateLimitKeyStrategy,
  keyResolver?: RateLimitKeyResolver,
): RateLimitPolicy {
  return fixedWindowPolicy({
    name,
    limit,
    windowMs: MINUTE_MS,
    key,
    keyResolver,
  });
}

export function perHourPolicy(
  name: string,
  limit: number,
  key: RateLimitKeyStrategy,
  keyResolver?: RateLimitKeyResolver,
): RateLimitPolicy {
  return fixedWindowPolicy({
    name,
    limit,
    windowMs: HOUR_MS,
    key,
    keyResolver,
  });
}
