import type { RateLimitStore, RateLimitStoreResult } from './contracts.js';

export type RedisEvalClient = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
};

const INCREMENT_FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIREAT', KEYS[1], ARGV[1])
end
return count
`;

/**
 * Redis-backed fixed-window store.
 *
 * The supplied client is expected to be connected and to provide an EVAL
 * operation compatible with the node-redis client API. A single-key Lua
 * script makes increment + expiry atomic across multiple application nodes.
 */
export class RedisStore implements RateLimitStore {
  constructor(
    private readonly client: RedisEvalClient,
    private readonly prefix = 'xhovile:rate-limit',
  ) {}

  async increment(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitStoreResult> {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    const redisKey = `${this.prefix}:${key}:${windowStart}`;
    const rawCount = await this.client.eval(INCREMENT_FIXED_WINDOW_SCRIPT, {
      keys: [redisKey],
      arguments: [String(resetAt)],
    });

    const count = toPositiveInteger(rawCount);
    return { count, resetAt };
  }
}

function toPositiveInteger(value: unknown): number {
  const count = typeof value === 'bigint'
    ? Number(value)
    : typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Redis rate-limit store returned an invalid counter value.');
  }

  return count;
}
