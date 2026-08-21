import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MemoryStore,
  RateLimitStoreUnavailableError,
  RateLimiter,
  fixedWindowPolicy,
  perMinutePolicy,
} from '../src/index.js';
import { rateLimit } from '../express/index.js';
import { RedisStore } from '../redis/index.js';

function createClock(startMs: number) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    set: (value: number) => {
      nowMs = value;
    },
  };
}

test('fixed-window limiter denies the request after the configured limit', async () => {
  const clock = createClock(60_000);
  const limiter = new RateLimiter(
    perMinutePolicy('test', 2, 'ip'),
    new MemoryStore(),
    { now: clock.now },
  );

  const first = await limiter.check({ ip: '10.0.0.1' });
  const second = await limiter.check({ ip: '10.0.0.1' });
  const third = await limiter.check({ ip: '10.0.0.1' });

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.equal(third.retryAfterMs, 60_000);
});

test('fixed-window boundary starts a fresh window', async () => {
  const clock = createClock(60_000);
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'boundary',
      limit: 1,
      windowMs: 10_000,
      key: 'ip',
    }),
    new MemoryStore(),
    { now: clock.now },
  );

  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, true);
  assert.equal((await limiter.check({ ip: '10.0.0.2' })).allowed, false);

  clock.set(70_000);
  const nextWindow = await limiter.check({ ip: '10.0.0.2' });
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.remaining, 0);
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
  assert.throws(
    () => new RateLimiter({ name: 'missing-resolver', limit: 1, windowMs: 60_000, key: 'custom' }, new MemoryStore()),
    /custom key resolver is required/,
  );
});

test('custom keys must be bounded strings', async () => {
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'custom-key',
      limit: 1,
      windowMs: 60_000,
      key: 'custom',
      keyResolver: () => 'x'.repeat(257),
    }),
    new MemoryStore(),
  );

  await assert.rejects(
    () => limiter.check({}),
    /at most 256 characters/,
  );
});

test('fail-closed turns store failure into RateLimitStoreUnavailableError', async () => {
  const failingStore = {
    increment: async () => {
      throw new Error('redis offline');
    },
  };
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'fail-closed',
      limit: 1,
      windowMs: 60_000,
      key: 'ip',
    }),
    failingStore,
  );

  await assert.rejects(
    () => limiter.check({ ip: '10.0.0.4' }),
    (error: unknown) => error instanceof RateLimitStoreUnavailableError,
  );
});

test('fail-open allows the request and marks the result as degraded', async () => {
  const failingStore = {
    increment: async () => {
      throw new Error('redis offline');
    },
  };
  const limiter = new RateLimiter(
    fixedWindowPolicy({
      name: 'fail-open',
      limit: 1,
      windowMs: 60_000,
      key: 'ip',
    }),
    failingStore,
    { storeFailure: 'fail-open' },
  );

  const result = await limiter.check({ ip: '10.0.0.5' });
  assert.equal(result.allowed, true);
  assert.equal(result.degraded, true);
});

test('RedisStore uses a single-key script and returns a fixed-window reset', async () => {
  let count = 0;
  let receivedScript = '';
  let receivedKey = '';
  let receivedResetAt = '';

  const store = new RedisStore({
    eval: async (script, options) => {
      count += 1;
      receivedScript = script;
      receivedKey = options.keys[0] ?? '';
      receivedResetAt = options.arguments[0] ?? '';
      return count;
    },
  });

  const result = await store.increment('test-key', 60_000, 60_000);
  assert.equal(result.count, 1);
  assert.equal(result.resetAt, 120_000);
  assert.match(receivedScript, /INCR/);
  assert.match(receivedScript, /PEXPIREAT/);
  assert.match(receivedKey, /test-key:60000$/);
  assert.equal(receivedResetAt, '120000');
});

test('Express adapter returns standard 429 headers', async () => {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown;
  let nextCalls = 0;

  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };

  const middleware = rateLimit({
    name: 'express-test',
    limit: 1,
    windowMs: 60_000,
    key: 'ip',
  });
  const request = { ip: '10.0.0.6', path: '/test', route: { path: '/test' } } as never;
  const next = () => {
    nextCalls += 1;
  };

  await middleware(request, response as never, next);
  await middleware(request, response as never, next);

  const retryAfter = Number(headers.get('Retry-After'));
  assert.equal(nextCalls, 1);
  assert.equal(statusCode, 429);
  assert.equal(headers.get('RateLimit-Limit'), '1');
  assert.equal(headers.get('RateLimit-Remaining'), '0');
  assert.ok(Number.isInteger(Number(headers.get('RateLimit-Reset'))));
  assert.ok(retryAfter >= 1 && retryAfter <= 60);
  assert.deepEqual(body, {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please retry later.',
    retryAfter,
  });
});
