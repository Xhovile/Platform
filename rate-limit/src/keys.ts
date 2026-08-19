import type {
  RateLimitContext,
  RateLimitKey,
  RateLimitKeyResolver,
  RateLimitKeyStrategy,
} from './contracts.js';

const DEFAULT_CUSTOM_KEY_PREFIX = 'custom';
const MAX_CUSTOM_KEY_LENGTH = 256;

export function resolveRateLimitKey(
  strategy: RateLimitKeyStrategy,
  context: RateLimitContext,
  customResolver?: RateLimitKeyResolver,
): RateLimitKey {
  switch (strategy) {
    case 'ip':
      return {
        strategy,
        value: `ip:${requireContextValue(context.ip, 'ip')}`,
      };
    case 'user':
      return {
        strategy,
        value: `user:${requireContextValue(context.userId, 'userId')}`,
      };
    case 'ip+user':
      return {
        strategy,
        value: `ip+user:${requireContextValue(context.ip, 'ip')}:${requireContextValue(context.userId, 'userId')}`,
      };
    case 'route':
      return {
        strategy,
        value: `route:${requireContextValue(context.route, 'route')}`,
      };
    case 'custom': {
      if (!customResolver) {
        throw new Error('A custom key resolver is required for the custom strategy.');
      }

      const value = customResolver(context);
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('The custom key resolver must return a non-empty string.');
      }
      if (value.length > MAX_CUSTOM_KEY_LENGTH) {
        throw new Error(`The custom key resolver must return at most ${MAX_CUSTOM_KEY_LENGTH} characters.`);
      }

      return {
        strategy,
        value: `${DEFAULT_CUSTOM_KEY_PREFIX}:${value}`,
      };
    }
  }
}

function requireContextValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Rate-limit key strategy requires context.${name}.`);
  }
  return value;
}
