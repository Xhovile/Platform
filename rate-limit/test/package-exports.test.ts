import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore, RateLimiter, perMinutePolicy } from '@xhovile/platform/rate-limit';
import { rateLimit } from '@xhovile/platform/rate-limit/express';
import { RedisStore } from '@xhovile/platform/rate-limit/redis';

test('package exports resolve for consumers', async () => {
  const limiter = new RateLimiter(
    perMinutePolicy('consumer-test', 1, 'user'),
    new MemoryStore(),
  );

  assert.equal((await limiter.check({ userId: 'consumer' })).allowed, true);
  assert.equal(typeof rateLimit, 'function');
  assert.equal(typeof RedisStore, 'function');
});
