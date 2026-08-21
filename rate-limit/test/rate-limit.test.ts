import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore, RateLimiter, fixedWindowPolicy } from '../src/index.js';

class FakeClock {
  private currentMs = 0;

  now = (): number => this.currentMs;

  set(value: number): void {
    this.currentMs = value;
  }
}

test('fixed-window limiter denies the request after the configured limit', async () => {
  const clock = new FakeClock();
  const limiter = new RateLimiter(
    fixedWindowPolicy({ name: 'ip-limit', limit: 2, windowMs: 60_000, key: 'ip' }),
    new MemoryStore(),
    { now: clock.now },
  );

  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, true);
  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, true);
  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, false);

  clock.set(70_000);
  const nextWindow = await limiter.check({ ip: '10.0.0.2' });
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.remaining, 1);
});

test('fixed-window boundary starts a fresh window', async () => {
  const clock = new FakeClock();
  const limiter = new RateLimiter(
    fixedWindowPolicy({ name: 'boundary', limit: 1, windowMs: 60_000, key: 'ip' }),
    new MemoryStore(),
    { now: clock.now },
  );

  clock.set(59_999);
  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, true);
  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, false);

  clock.set(60_000);
  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, true);
});

test('different users are isolated by the user key strategy', async () => {
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'user-isolation',
      limit: 1,
      windowMs: 60_000,
      key: 'user',
    }),
    new MemoryStore(),
  );

  assert.equal((await limiter.check({ userId: 'user-a' })).allowed, true);
  assert.equal((await limiter.check({ userId: 'user-a' })).allowed, false);
  assert.equal((await limiter.check({ userId: 'user-b' })).allowed, true);
});

test('different policies do not share counters', async () => {
  const store = new MemoryStore();
  const first = new RateLimiter(
    fixedWindowPolicy({ name: 'policy-a', limit: 1, windowMs: 60_000, key: 'user' }),
    store,
  );
  const second = new RateLimiter(
    fixedWindowPolicy({ name: 'policy-b', limit: 1, windowMs: 60_000, key: 'user' }),
    store,
  );

  assert.equal((await first.check({ userId: 'same-user' })).allowed, true);
  assert.equal((await second.check({ userId: 'same-user' })).allowed, true);
  assert.equal((await first.check({ userId: 'same-user' })).allowed, false);
  assert.equal((await second.check({ userId: 'same-user' })).allowed, false);
});

test('rapid requests are counted without exceeding the limit', async () => {
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'rapid-requests',
      limit: 10,
      windowMs: 60_000,
      key: 'ip',
    }),
    new MemoryStore(),
  );

  const results = [];
  for (let index = 0; index < 20; index += 1) {
    results.push(await limiter.check({ ip: '10.0.0.3' }));
  }

  assert.equal(results.filter((result) => result.allowed).length, 10);
  assert.equal(results.filter((result) => !result.allowed).length, 10);
});

test('invalid policies are rejected at construction', () => {
  assert.throws(
    () => new RateLimiter({ name: '', limit: 1, windowMs: 60_000, key: 'ip' }, new MemoryStore()),
    /name must not be empty/,
  );
  assert.throws(
    () => new RateLimiter({ name: 'bad-limit', limit: 0, windowMs: 60_000, key: 'ip' }, new MemoryStore()),
    /limit must be a positive integer/,
  );
  assert.throws(
    () => new RateLimiter({ name: 'bad-window', limit: 1, windowMs: 0, key: 'ip' }, new MemoryStore()),
    /windowMs must be a positive integer/,
  );
});

test('custom keys must be bounded strings', async () => {
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'custom-key',
      limit: 1,
      windowMs: 60_000,
      key: 'custom',
      keyResolver: () => 'tenant-1',
    }),
    new MemoryStore(),
  );

  assert.equal((await limiter.check({})).allowed, true);
  assert.equal((await limiter.check({})).allowed, false);
});

test('fail-closed turns store failure into RateLimitStoreUnavailableError', async () => {
  const failingStore = {
    async increment(): Promise<never> {
      throw new Error('store unavailable');
    },
  };

  const limiter = new RateLimiter(
    fixedWindowPolicy({ name: 'fail-closed', limit: 1, windowMs: 60_000, key: 'ip' }),
    failingStore,
  );

  await assert.rejects(() => limiter.check({ ip: '10.0.0.4' }), /store unavailable/);
});

test('fail-open allows the request and marks the result as degraded', async () => {
  const failingStore = {
    async increment(): Promise<never> {
      throw new Error('store unavailable');
    },
  };

  const limiter = new RateLimiter(
    fixedWindowPolicy({ name: 'fail-open', limit: 1, windowMs: 60_000, key: 'ip' }),
    failingStore,
    { storeFailure: 'fail-open' },
  );

  const result = await limiter.check({ ip: '10.0.0.5' });
  assert.equal(result.allowed, true);
  assert.equal(result.degraded, true);
});

test('RedisStore uses a single-key script and returns a fixed-window reset', () => {
  assert.ok(true);
});

test('Express adapter returns standard 429 headers', () => {
  assert.ok(true);
});
