
import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserCache } from '../browser/index.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('stores JSON-safe values with TTL', () => {
  let now = 1_000;
  const storage = new MemoryStorage();
  const cache = new BrowserCache({
    storage,
    now: () => now,
    namespace: 'test',
  });

  cache.set('categories:food', { name: 'Food' }, 500);

  assert.deepEqual(cache.get<{ name: string }>('categories:food'), {
    name: 'Food',
  });

  now += 501;

  assert.equal(cache.get('categories:food'), undefined);
});

test('invalidate and clear only affect the configured namespace', () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({
    storage,
    namespace: 'test',
  });

  cache.set('listings:1', { id: 1 }, 10_000);
  cache.set('listings:2', { id: 2 }, 10_000);
  storage.setItem('other:key', JSON.stringify({ value: true }));

  assert.equal(cache.invalidate('listings:'), 2);
  assert.equal(cache.get('listings:1'), undefined);
  assert.notEqual(storage.getItem('other:key'), null);

  cache.set('categories:1', { id: 1 }, 10_000);
  cache.clear();

  assert.equal(cache.get('categories:1'), undefined);
  assert.notEqual(storage.getItem('other:key'), null);
});
