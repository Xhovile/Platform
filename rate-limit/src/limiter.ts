import {
  resolveRateLimitKey,
} from './keys.js';
import type {
  RateLimitContext,
  RateLimitKeyResolver,
  RateLimitPolicy,
  RateLimitResult,
  RateLimitStore,
} from './contracts.js';

export class RateLimiter {
  private readonly policy: RateLimitPolicy;
  private readonly store: RateLimitStore;
  private readonly keyResolver?: RateLimitKeyResolver;
  private readonly now: () => number;

  constructor(
    policy: RateLimitPolicy,
    store: RateLimitStore,
    options: { now?: () => number } = {},
  ) {
    validatePolicy(policy);
    this.policy = policy;
    this.store = store;
    this.keyResolver = policy.keyResolver;
    this.now = options.now ?? Date.now;
  }

  async check(context: RateLimitContext): Promise<RateLimitResult> {
    const nowMs = this.now();
    const resolvedKey = resolveRateLimitKey(
      this.policy.key,
      context,
      this.keyResolver,
    );
    const storeKey = `${this.policy.name}:${resolvedKey.value}`;
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
    };
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
