
export type CacheSetOptions = {
  /** Time-to-live in milliseconds. */
  ttlMs: number;
};

export type CacheStats = {
  /** Number of currently stored, non-expired entries. */
  size: number;
  /** Maximum number of entries retained by the cache. */
  maxEntries: number;
};

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  invalidate(prefix: string): Promise<number>;
  getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions,
  ): Promise<T>;
  clear(): Promise<void>;
}
