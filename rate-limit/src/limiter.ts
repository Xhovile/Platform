import {
  resolveRateLimitKey,
} from './keys.js';
import type {
  RateLimitContext,
  RateLimitKeyResolver,
  RateLimitPolicy,
  RateLimitResult,
  RateLimitStore,
  RateLimitStoreFailureMode,
} from './contracts.js';
import { RateLimitStoreUnavailableError } from './contracts.js';

export type RateLimiterOptions = {
  now?: () => number;
  /**
   * `fail-closed` rejects requests when the backing store is unavailable.
   * `fail-open` allows the request and marks the result as degraded.
   */
  storeFailure?: RateLimitStoreFailureMode;
};

export class RateLimiter {
  private readonly policy: RateLimitPolicy;
  private readonly store: RateLimitStore;
  private readonly keyResolver?: RateLimitKeyResolver;
  private readonly now: () => number;
  private readonly storeFailure: RateLimitStoreFailureMode;

  constructor(
    policy: RateLimitPolicy,
    store: RateLimitStore,
    options: RateLimiterOptions = {},
  ) {
    validatePolicy(policy);
    this.policy = policy;
    this.store = store;
    this.keyResolver = policy.keyResolver;
    this.now = options.now ?? Date.now;
    this.storeFailure = options.storeFailure ?? 'fail-closed';
  }

  async check(context: RateLimitContext): Promise<RateLimitResult> {
    const nowMs = this.now();
    const resolvedKey = resolveRateLimitKey(
      this.policy.key,
      context,
      this.keyResolver,
    );
    const storeKey = `${this.policy.name}:${resolvedKey.value}`;

    try {
      const state = await this.store.increment(
        storeKey,
        this.policy.windowMs,
        nowMs,
      );

      const allowed = state.count <= this.policy.limit;
      const remaining = Math.max(0, this.policy.limit - state.count);
      const retryAfterMs = allowed
        ? 0
        : Math.max(0, state.resetAt - nowMs);

      return {
        allowed,
        limit: this.policy.limit,
        remaining,
        resetAt: state.resetAt,
        retryAfterMs,
        degraded: false,
      };
    } catch (error) {
      if (this.storeFailure === 'fail-open') {
        return {
          allowed: true,
          limit: this.policy.limit,
          remaining: this.policy.limit,
          resetAt: nowMs,
          retryAfterMs: 0,
          degraded: true,
        };
      }

      throw new RateLimitStoreUnavailableError(error);
    }
  }
}

function validatePolicy(policy: RateLimitPolicy): void {
  if (!policy.name.trim()) {
    throw new Error('Rate-limit policy name must not be empty.');
  }

  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1) {
    throw new Error('Rate-limit policy limit must be a positive integer.');
  }

  if (!Number.isSafeInteger(policy.windowMs) || policy.windowMs < 1) {
    throw new Error('Rate-limit policy windowMs must be a positive integer.');
  }

  if (policy.key === 'custom' && !policy.keyResolver) {
    throw new Error('A custom key resolver is required for the custom strategy.');
  }
}
