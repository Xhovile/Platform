export type RateLimitPolicy = {
  /** Stable identifier for this policy. */
  name: string;
  /** Maximum number of requests permitted per window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Request-key strategy used to partition counters. */
  key: RateLimitKeyStrategy;
  /** Required only when key is `custom`. */
  keyResolver?: RateLimitKeyResolver;
};

export type RateLimitKeyStrategy =
  | 'ip'
  | 'user'
  | 'ip+user'
  | 'route'
  | 'custom';

export type RateLimitContext = {
  /** Client IP, when known by the consuming application. */
  ip?: string;
  /** Authenticated user identifier, when available. */
  userId?: string;
  /** Canonical application route identifier. */
  route?: string;
};

export type RateLimitKeyResolver = (
  context: RateLimitContext,
) => string;

export type RateLimitStoreResult = {
  /** Current request count for the active fixed window. */
  count: number;
  /** Epoch time, in milliseconds, at which the active window resets. */
  resetAt: number;
};

export interface RateLimitStore {
  /**
   * Atomically increment the counter for a key within its current fixed window.
   * The store owns counter persistence and window expiry; the limiter owns the
   * decision about whether the resulting count is allowed by policy.
   */
  increment(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitStoreResult>;
}

export type RateLimitResult = {
  /** Whether the request is permitted. */
  allowed: boolean;
  /** Configured maximum requests for the policy window. */
  limit: number;
  /** Requests still available in the current window. */
  remaining: number;
  /** Epoch time, in milliseconds, when the current window resets. */
  resetAt: number;
  /** Milliseconds until the request should be retried; zero when allowed. */
  retryAfterMs: number;
};

export type RateLimitKey = {
  /** Fully resolved counter key. */
  value: string;
  /** Strategy that produced the key. */
  strategy: RateLimitKeyStrategy;
};
