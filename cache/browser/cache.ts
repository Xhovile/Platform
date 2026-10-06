type BrowserCacheEntry = {
  value: unknown;
  expiresAt: number;
};

export type BrowserCacheOptions = {
  /** Storage namespace. Defaults to xhovile:cache when omitted. */
  namespace?: string;
  /** Storage implementation. Defaults to browser localStorage. */
  storage?: Storage;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

/**
 * Best-effort browser cache backed by localStorage.
 *
 * Cached values are local to the user's browser/device and are not shared with
 * other users or backend instances. Storage failures are treated as cache
 * misses so the cache cannot become a hard dependency of the application.
 */
export class BrowserCache {
  private readonly namespace: string;
  private readonly storage: Storage | undefined;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: BrowserCacheOptions = {}) {
    const namespace = options.namespace?.trim();

    if (namespace === '') {
      throw new Error('Browser cache namespace must not be empty.');
    }

    this.namespace = namespace ?? 'xhovile:cache';
    this.storage = options.storage ?? getLocalStorage();
    this.now = options.now ?? Date.now;
  }

  get<T>(key: string): T | undefined {
    this.validateKey(key);

    if (!this.storage) return undefined;

    const storageKey = this.toStorageKey(key);

    try {
      const raw = this.storage.getItem(storageKey);
      if (raw === null) return undefined;

      const entry = JSON.parse(raw) as BrowserCacheEntry;
      if (
        !entry ||
        typeof entry.expiresAt !== 'number' ||
        entry.expiresAt <= this.now()
      ) {
        this.storage.removeItem(storageKey);
        return undefined;
      }

      return entry.value as T;
    } catch {
      try {
        this.storage.removeItem(storageKey);
      } catch {
        // Ignore storage cleanup failures; caching remains best effort.
      }
      return undefined;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.validateKey(key);
    this.validateTtl(ttlMs);

    if (!this.storage) return;

    const entry: BrowserCacheEntry = {
      value,
      expiresAt: this.now() + ttlMs,
    };

    try {
      this.storage.setItem(
        this.toStorageKey(key),
        JSON.stringify(entry),
      );
    } catch {
      // Browser caching is an optimization. Quota/serialization failures
      // must never prevent the application from serving underlying data.
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    this.validateKey(key);

    if (!this.storage) return false;

    const storageKey = this.toStorageKey(key);
    try {
      const existed = this.storage.getItem(storageKey) !== null;
      this.storage.removeItem(storageKey);
      return existed;
    } catch {
      return false;
    }
  }

  invalidate(prefix: string): number {
    if (!prefix) {
      throw new Error(
        'Browser cache invalidation prefix must not be empty.',
      );
    }

    if (!this.storage) return 0;

    const keysToDelete: string[] = [];

    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const storageKey = this.storage.key(index);
        if (storageKey?.startsWith(this.namespace + ':' + prefix)) {
          keysToDelete.push(storageKey);
        }
      }

      for (const storageKey of keysToDelete) {
        this.storage.removeItem(storageKey);
      }

      return keysToDelete.length;
    } catch {
      return 0;
    }
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs: number,
  ): Promise<T> {
    this.validateKey(key);
    this.validateTtl(ttlMs);

    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return (await existing) as T;

    const loadPromise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        if (this.inFlight.get(key) === loadPromise) {
          this.inFlight.delete(key);
        }
      }
    })();

    this.inFlight.set(key, loadPromise);
    return loadPromise;
  }

  clear(): void {
    if (!this.storage) return;

    const keysToDelete: string[] = [];

    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const storageKey = this.storage.key(index);
        if (storageKey?.startsWith(this.namespace + ':')) {
          keysToDelete.push(storageKey);
        }
      }

      for (const storageKey of keysToDelete) {
        this.storage.removeItem(storageKey);
      }
    } catch {
      // Best effort by design.
    }
  }

  private toStorageKey(key: string): string {
    return this.namespace + ':' + key;
  }

  private validateKey(key: string): void {
    if (!key.trim()) {
      throw new Error('Browser cache key must not be empty.');
    }
  }

  private validateTtl(ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('Browser cache TTL must be a positive finite number.');
    }
  }
}

function getLocalStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? undefined
      : globalThis.localStorage;
  } catch {
    return undefined;
  }
}
