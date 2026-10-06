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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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

test('malformed entries are treated as misses and removed', () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({
    storage,
    namespace: 'test',
  });

  storage.setItem('test:broken', '{not-json');

  assert.equal(cache.get('broken'), undefined);
  assert.equal(storage.getItem('test:broken'), null);
});

test('getOrSet coalesces concurrent misses', async () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({ storage, namespace: 'test' });
  let loads = 0;

  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { value: 42 };
  };

  const [first, second, third] = await Promise.all([
    cache.getOrSet('hot-key', loader, 10_000),
    cache.getOrSet('hot-key', loader, 10_000),
    cache.getOrSet('hot-key', loader, 10_000),
  ]);

  assert.equal(loads, 1);
  assert.deepEqual(first, { value: 42 });
  assert.deepEqual(second, { value: 42 });
  assert.deepEqual(third, { value: 42 });
});

test('getOrSet clears failed in-flight loads so the key can be retried', async () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({ storage, namespace: 'test' });
  let loads = 0;

  await assert.rejects(
    cache.getOrSet(
      'retry-key',
      () => {
        loads += 1;
        throw new Error('loader failed');
      },
      10_000,
    ),
    /loader failed/,
  );

  const value = await cache.getOrSet(
    'retry-key',
    async () => {
      loads += 1;
      return 'recovered';
    },
    10_000,
  );

  assert.equal(loads, 2);
  assert.equal(value, 'recovered');
});

test('delete prevents an older in-flight load from repopulating the entry', async () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({ storage, namespace: 'test' });
  const load = deferred<string>();

  const pending = cache.getOrSet(
    'delete-key',
    () => load.promise,
    10_000,
  );

  assert.equal(cache.delete('delete-key'), false);
  load.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(cache.get('delete-key'), undefined);
});

test('invalidate prevents an older in-flight load from repopulating the prefix', async () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({ storage, namespace: 'test' });
  const load = deferred<string>();

  const pending = cache.getOrSet(
    'listings:food:1',
    () => load.promise,
    10_000,
  );

  cache.set('listings:food:2', { id: 2 }, 10_000);
  assert.equal(cache.invalidate('listings:food:'), 1);

  load.resolve('stale');
  assert.equal(await pending, 'stale');
  assert.equal(cache.get('listings:food:1'), undefined);
});

test('clear prevents pre-clear in-flight loads from repopulating the cache', async () => {
  const storage = new MemoryStorage();
  const cache = new BrowserCache({ storage, namespace: 'test' });
  const load = deferred<string>();

  const pending = cache.getOrSet(
    'clear-key',
    () => load.promise,
    10_000,
  );

  cache.clear();
  load.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(cache.get('clear-key'), undefined);
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

test('rejects invalid TTLs, keys, prefixes, and namespaces', () => {
  const cache = new BrowserCache({ storage: new MemoryStorage() });

  assert.throws(
    () => cache.set('key', 'value', 0),
    /TTL must be a positive finite number/,
  );
  assert.throws(
    () => cache.get('   '),
    /key must not be empty/,
  );
  assert.throws(
    () => cache.invalidate('   '),
    /prefix must not be empty/,
  );
  assert.throws(
    () => new BrowserCache({
      storage: new MemoryStorage(),
      namespace: '   ',
    }),
    /namespace must not be empty/,
  );
});
