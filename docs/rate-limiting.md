# Platform Rate Limiting

The rate limiter is reusable infrastructure. Platform owns the limiting mechanism; consuming applications own the policy values and application-specific request context.

## Architecture

```text
Consuming application
       │
       ├── policy: name / limit / window / key strategy
       │
       ▼
RateLimiter core
       │
       ├── MemoryStore  → single instance
       │
       └── RedisStore   → multiple instances
       │
       ▼
Express adapter (when using Express)
```

## Core example

```ts
import {
  MemoryStore,
  RateLimiter,
  perMinutePolicy,
} from '@xhovile/platform/rate-limit';

const limiter = new RateLimiter(
  perMinutePolicy('message-send', 30, 'user'),
  new MemoryStore(),
);

const result = await limiter.check({ userId: 'user-123' });

if (!result.allowed) {
  // result.retryAfterMs tells the caller when to retry.
}
```

## Express example

```ts
import { rateLimit } from '@xhovile/platform/rate-limit/express';

app.post(
  '/messages',
  rateLimit({
    name: 'message-send',
    limit: 30,
    windowMs: 60_000,
    key: 'user',
    getUserId: (req) => req.user?.id,
    storeFailure: 'fail-closed',
  }),
  sendMessage,
);
```

The adapter sends these headers on normal requests:

- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`

When the request is denied it returns HTTP `429` and adds `Retry-After`.

## Redis example

```ts
import { createClient } from 'redis';
import { RedisStore } from '@xhovile/platform/rate-limit/redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const store = new RedisStore(redis);
```

Redis is not required by Platform. Applications using one server can use `MemoryStore`; applications running multiple instances should use a shared store such as Redis.

## Key strategies

- `ip` — partition by client IP.
- `user` — partition by authenticated user ID.
- `ip+user` — partition by both.
- `route` — share a bucket by canonical route identifier.
- `custom` — application-provided resolver over Platform's generic context.

For IP-aware policies behind a reverse proxy, the consuming application must configure its framework's trusted-proxy behavior correctly so the IP supplied to Platform is trustworthy.

## Store failure semantics

Platform supports two explicit modes:

- `fail-closed` — reject when the backing store is unavailable. This is the default and is appropriate for security-sensitive endpoints where bypassing the limiter is unacceptable.
- `fail-open` — allow the request and mark the result as degraded. This may be appropriate for non-security-critical endpoints where availability is more important than strict enforcement.

A consuming application should choose the mode per endpoint class rather than treating all endpoints identically.
