
import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCache } from '../src/index.js';

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

test('rejects invalid TTLs and keys', async () => {
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
    cache.invalidate(''),
    /prefix must not be empty/,
  );
});
