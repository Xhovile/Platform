import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore, RateLimiter, fixedWindowPolicy } from '../src/index.js';

test('debug concurrency behavior', async () => {
  const limiter = new RateLimiter(
    fixedWindowPolicy({ name: 'concurrency-debug', limit: 10, windowMs: 60_000, key: 'ip' }),
    new MemoryStore(),
  );
  const results = await Promise.all(Array.from({ length: 20 }, () => limiter.check({ ip: '10.0.0.3' })));
  const counts = results.map(r => r.remaining);
  console.log('allowed', results.filter(r => r.allowed).length, 'remaining', counts);
  assert.equal(results.length, 20);
});
