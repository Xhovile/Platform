import type {
  Cache,
  CacheSetOptions,
  CacheStats,
} from './contracts.js';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  accessOrder: number;
};

export type MemoryCacheOptions = {
  /** Maximum number of entries kept in memory. Defaults to 1,000. */
  maxEntries?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

/**
 * Bounded in-process TTL cache with LRU-style eviction.
 *
 * This cache has no external infrastructure dependency. It is process-local:
 * values are lost when the process restarts and are not shared across
 * application instances.
 *
 * getOrSet() coalesces concurrent cache misses for the same key so multiple
 * requests do not all execute the same loader simultaneously.
 *
 * delete(), invalidate(), and clear() also prevent older in-flight loads from
 * repopulating entries after an explicit cache mutation.
 */
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly keyVersions = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private generation = 0;
  private nextAccessOrder = 0;

  constructor(options: MemoryCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? 1_000;

    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Cache maxEntries must be a positive safe integer.');
    }

    this.maxEntries = maxEntries;
    this.now = options.now ?? Date.now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    this.validateKey(key);

    const entry = this.entries.get(key);
    if (!entry) return undefined;

    const now = this.now();
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }

    entry.accessOrder = this.nextAccess();
    return entry.value as T;
  }

  async set<T>(
    key: string,
    value: T,
    options: CacheSetOptions,
  ): Promise<void> {
    this.validateKey(key);
    this.validateTtl(options.ttlMs);

    const now = this.now();
    this.entries.set(key, {
      value,
      expiresAt: now + options.ttlMs,
      accessOrder: this.nextAccess(),
    });

    this.evictIfNeeded();
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<boolean> {
    this.validateKey(key);
    this.invalidateInFlightKey(key);
    return this.entries.delete(key);
  }

  async invalidate(prefix: string): Promise<number> {
    if (!prefix.trim()) {
      throw new Error('Cache invalidation prefix must not be empty.');
    }

    let removed = 0;

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix) && this.entries.delete(key)) {
        removed += 1;
      }
    }

    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.invalidateInFlightKey(key);
      }
    }

    return removed;
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions,
  ): Promise<T> {
    this.validateKey(key);
    this.validateTtl(options.ttlMs);

    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return (await existing) as T;

    const generation = this.generation;
    const keyVersion = this.keyVersions.get(key) ?? 0;

    let resolveLoad!: (value: T) => void;
    let rejectLoad!: (reason: unknown) => void;
    const loadPromise = new Promise<T>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });

    this.inFlight.set(key, loadPromise);

    void (async () => {
      try {
        const value = await loader();

        if (
          generation === this.generation &&
          keyVersion === (this.keyVersions.get(key) ?? 0)
        ) {
          await this.set(key, value, options);
        }

        resolveLoad(value);
      } catch (error) {
        rejectLoad(error);
      } finally {
        if (this.inFlight.get(key) === loadPromise) {
          this.inFlight.delete(key);
          this.keyVersions.delete(key);
        }
      }
    })();

    return loadPromise;
  }

  async clear(): Promise<void> {
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
    this.keyVersions.clear();
  }

  /** Remove expired entries and return how many were removed. */
  prune(): number {
    const now = this.now();
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  get stats(): CacheStats {
    this.prune();
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
    };
  }

  private evictIfNeeded(): void {
    this.prune();

    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAccessOrder = Number.POSITIVE_INFINITY;

      for (const [key, entry] of this.entries) {
        if (entry.accessOrder < oldestAccessOrder) {
          oldestAccessOrder = entry.accessOrder;
          oldestKey = key;
        }
      }

      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }

  private invalidateInFlightKey(key: string): void {
    if (!this.inFlight.has(key)) return;

    this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
  }

  private nextAccess(): number {
    this.nextAccessOrder += 1;
    return this.nextAccessOrder;
  }

  private validateKey(key: string): void {
    if (!key.trim()) {
      throw new Error('Cache key must not be empty.');
    }
  }

  private validateTtl(ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Cache TTL must be a positive finite number.');
    }
  }
}
