import type { RateLimitStore, RateLimitStoreResult } from './contracts.js';

type MemoryCounter = {
  count: number;
  resetAt: number;
};

/**
 * In-process fixed-window counter store.
 *
 * The store has no framework or infrastructure dependencies and is intended
 * for single-instance applications or local development.
 */
export class MemoryStore implements RateLimitStore {
  private readonly counters = new Map<string, MemoryCounter>();

  async increment(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitStoreResult> {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    const existing = this.counters.get(key);

    if (!existing || existing.resetAt <= nowMs) {
      const next = { count: 1, resetAt };
      this.counters.set(key, next);
      return { ...next };
    }

    existing.count += 1;
    return { ...existing };
  }

  /** Remove counters that have already expired. */
  prune(nowMs = Date.now()): number {
    let removed = 0;

    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= nowMs) {
        this.counters.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  /** Number of counters currently held in memory. */
  get size(): number {
    return this.counters.size;
  }
}
