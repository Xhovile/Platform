import type { NextFunction, Request, RequestHandler } from 'express';
import { MemoryStore } from '../memory-store.js';
import { RateLimiter } from '../limiter.js';
import {
  RateLimitStoreUnavailableError,
  type RateLimitContext,
  type RateLimitKeyResolver,
  type RateLimitKeyStrategy,
  type RateLimitPolicy,
  type RateLimitStore,
  type RateLimitStoreFailureMode,
} from '../contracts.js';

export type ExpressRateLimitOptions = Omit<RateLimitPolicy, 'keyResolver'> & {
  /** Optional store; MemoryStore is used when omitted. */
  store?: RateLimitStore;
  /** How requests behave when the backing store is unavailable. */
  storeFailure?: RateLimitStoreFailureMode;
  /** Extract the client IP used by the `ip` and `ip+user` strategies. */
  getIp?: (request: Request) => string | undefined;
  /** Extract the authenticated user identifier used by user-based strategies. */
  getUserId?: (request: Request) => string | undefined;
  /** Extract a canonical route identifier used by the `route` strategy. */
  getRoute?: (request: Request) => string | undefined;
  /** Resolve custom keys from the normalized Platform context. */
  keyResolver?: RateLimitKeyResolver;
};

export function rateLimit(options: ExpressRateLimitOptions): RequestHandler {
  const {
    store,
    storeFailure,
    getIp,
    getUserId,
    getRoute,
    keyResolver,
    ...policy
  } = options;

  const limiter = new RateLimiter(
    {
      ...policy,
      key: policy.key as RateLimitKeyStrategy,
      keyResolver,
    },
    store ?? new MemoryStore(),
    { storeFailure },
  );

  return async function rateLimitMiddleware(
    request: Request,
    response: Parameters<RequestHandler>[1],
    next: NextFunction,
  ): Promise<void> {
    try {
      const context: RateLimitContext = {
        ip: getIp?.(request) ?? request.ip,
        userId: getUserId?.(request),
        route: getRoute?.(request) ?? resolveDefaultRoute(request),
      };

      const result = await limiter.check(context);
      setRateLimitHeaders(response, result.limit, result.remaining, result.resetAt);

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        response.setHeader('Retry-After', String(retryAfterSeconds));
        response.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please retry later.',
          retryAfter: retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (error) {
      if (error instanceof RateLimitStoreUnavailableError) {
        response.status(503).json({
          error: 'Service Unavailable',
          message: 'Rate limiting is temporarily unavailable. Please retry later.',
        });
        return;
      }

      next(error);
    }
  };
}

function setRateLimitHeaders(
  response: Parameters<RequestHandler>[1],
  limit: number,
  remaining: number,
  resetAt: number,
): void {
  const resetSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
  response.setHeader('RateLimit-Limit', String(limit));
  response.setHeader('RateLimit-Remaining', String(remaining));
  response.setHeader('RateLimit-Reset', String(resetSeconds));
}

function resolveDefaultRoute(request: Request): string {
  const routePath = request.route?.path;
  if (typeof routePath === 'string') {
    return routePath;
  }

  return request.path;
}
