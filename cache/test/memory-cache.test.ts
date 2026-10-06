import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCache } from '../src/index.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

test('stores values and serves cache hits before expiry', async () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now });

  await cache.set('categories:food', ['snacks'], { ttlMs: 500 });

  assert.deepEqual(await cache.get<string[]>('categories:food'), ['snacks']);
  assert.equal(await cache.has('categories:food'), true);

  now += 501;

  assert.equal(await cache.get('categories:food'), undefined);
  assert.equal(await cache.has('categories:food'), false);
});

test('invalidate removes all keys under a prefix', async () => {
  const cache = new MemoryCache();

  await cache.set('listings:food:1', { id: 1 }, { ttlMs: 10_000 });
  await cache.set('listings:food:2', { id: 2 }, { ttlMs: 10_000 });
  await cache.set('listings:clothing:1', { id: 3 }, { ttlMs: 10_000 });

  assert.equal(await cache.invalidate('listings:food:'), 2);
  assert.equal(await cache.get('listings:food:1'), undefined);
  assert.deepEqual(await cache.get('listings:clothing:1'), { id: 3 });
});

test('getOrSet coalesces concurrent misses', async () => {
  const cache = new MemoryCache();
  let loads = 0;

  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { value: 42 };
  };

  const [first, second, third] = await Promise.all([
    cache.getOrSet('hot-key', loader, { ttlMs: 10_000 }),
    cache.getOrSet('hot-key', loader, { ttlMs: 10_000 }),
    cache.getOrSet('hot-key', loader, { ttlMs: 10_000 }),
  ]);

  assert.equal(loads, 1);
  assert.deepEqual(first, { value: 42 });
  assert.deepEqual(second, { value: 42 });
  assert.deepEqual(third, { value: 42 });
});

test('getOrSet clears failed in-flight loads so the key can be retried', async () => {
  const cache = new MemoryCache();
  let loads = 0;

  await assert.rejects(
    cache.getOrSet(
      'retry-key',
      async () => {
        loads += 1;
        throw new Error('loader failed');
      },
      { ttlMs: 10_000 },
    ),
    /loader failed/,
  );

  const value = await cache.getOrSet(
    'retry-key',
    async () => {
      loads += 1;
      return 'recovered';
    },
    { ttlMs: 10_000 },
  );

  assert.equal(loads, 2);
  assert.equal(value, 'recovered');
});

test('getOrSet handles synchronous loader throws without poisoning the key', async () => {
  const cache = new MemoryCache();
  let loads = 0;

  await assert.rejects(
    cache.getOrSet(
      'sync-failure',
      () => {
        loads += 1;
        throw new Error('sync failure');
      },
      { ttlMs: 10_000 },
    ),
    /sync failure/,
  );

  const value = await cache.getOrSet(
    'sync-failure',
    async () => {
      loads += 1;
      return 7;
    },
    { ttlMs: 10_000 },
  );

  assert.equal(loads, 2);
  assert.equal(value, 7);
});

test('delete prevents an older in-flight load from repopulating the entry', async () => {
  const cache = new MemoryCache();
  const load = deferred<string>();

  const pending = cache.getOrSet(
    'delete-key',
    () => load.promise,
    { ttlMs: 10_000 },
  );

  assert.equal(await cache.delete('delete-key'), false);
  load.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(await cache.get('delete-key'), undefined);
});

test('invalidate prevents an older in-flight load from repopulating the prefix', async () => {
  const cache = new MemoryCache();
  const load = deferred<string>();

  const pending = cache.getOrSet(
    'listings:food:1',
    () => load.promise,
    { ttlMs: 10_000 },
  );

  await cache.set('listings:food:2', { id: 2 }, { ttlMs: 10_000 });
  assert.equal(await cache.invalidate('listings:food:'), 1);

  load.resolve('stale');
  assert.equal(await pending, 'stale');
  assert.equal(await cache.get('listings:food:1'), undefined);
});

test('clear prevents pre-clear in-flight loads from repopulating the cache', async () => {
  const cache = new MemoryCache();
  const load = deferred<string>();

  const pending = cache.getOrSet(
    'clear-key',
    () => load.promise,
    { ttlMs: 10_000 },
  );

  await cache.clear();
  load.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(await cache.get('clear-key'), undefined);
});

test('bounded cache evicts the least recently used entry', async () => {
  let now = 1_000;
  const cache = new MemoryCache({ maxEntries: 2, now: () => now });

  await cache.set('first', 1, { ttlMs: 10_000 });
  now += 1;
  await cache.set('second', 2, { ttlMs: 10_000 });

  assert.equal(await cache.get('first'), 1);
  now += 1;
  await cache.set('third', 3, { ttlMs: 10_000 });

  assert.equal(await cache.get('first'), 1);
  assert.equal(await cache.get('second'), undefined);
  assert.equal(await cache.get('third'), 3);
});

test('prune and stats reflect expiry', async () => {
  let now = 1_000;
  const cache = new MemoryCache({ now: () => now });

  await cache.set('short', 'value', { ttlMs: 100 });
  await cache.set('long', 'value', { ttlMs: 1_000 });

  now += 101;

  assert.equal(cache.prune(), 1);
  assert.deepEqual(cache.stats, { size: 1, maxEntries: 1_000 });
});

test('delete and clear remove cached values', async () => {
  const cache = new MemoryCache();

  await cache.set('one', 1, { ttlMs: 10_000 });
  await cache.set('two', 2, { ttlMs: 10_000 });

  assert.equal(await cache.delete('one'), true);
  assert.equal(await cache.delete('one'), false);
  assert.equal(await cache.get('one'), undefined);

  await cache.clear();
  assert.equal(await cache.get('two'), undefined);
  assert.deepEqual(cache.stats, { size: 0, maxEntries: 1_000 });
});

test('rejects invalid TTLs, keys, prefixes, and maxEntries', async () => {
  const cache = new MemoryCache();

  await assert.rejects(
    cache.set('key', 'value', { ttlMs: 0 }),
    /TTL must be a positive finite number/,
  );
  await assert.rejects(
    cache.get('   '),
    /key must not be empty/,
  );
  await assert.rejects(
    cache.invalidate('   '),
    /prefix must not be empty/,
  );
  assert.throws(
    () => new MemoryCache({ maxEntries: 0 }),
    /maxEntries must be a positive safe integer/,
  );
});
