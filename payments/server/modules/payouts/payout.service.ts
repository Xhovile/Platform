import { createRequire } from 'node:module';
import type { PayoutRepository as PayoutRepositoryType } from './payout.repository.js';
import type { PayoutTransitionRepository as PayoutTransitionRepositoryType } from './payout.transition-repository.js';
import type { PayoutService as PayoutServiceType } from './payout.service.core.js';

export * from './payout.shared.js';

const require = createRequire(import.meta.url);

type ModuleName = 'payout.repository' | 'payout.transition-repository' | 'payout.service.core';

function loadModule(name: ModuleName): any {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return require(new URL(`./${name}${extension}`, import.meta.url).pathname);
}

function bindMethods<T extends object>(target: T): T {
  return new Proxy(target, {
    get(current, property, receiver) {
      const value = Reflect.get(current, property, receiver);
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
}

function lazySingleton<T extends object>(loader: () => T): T {
  let target: T | null = null;
  return new Proxy({} as T, {
    get(_current, property) {
      target ??= loader();
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export class PayoutRepository {
  constructor(...args: any[]) {
    const Actual = loadModule('payout.repository').PayoutRepository as new (...ctorArgs: any[]) => object;
    return bindMethods(new Actual(...args));
  }
}

export class PayoutTransitionRepository {
  constructor(...args: any[]) {
    const Actual = loadModule('payout.transition-repository').PayoutTransitionRepository as new (...ctorArgs: any[]) => object;
    return bindMethods(new Actual(...args));
  }
}

export const payoutRepository = lazySingleton<PayoutTransitionRepositoryType>(
  () => loadModule('payout.transition-repository').payoutRepository as PayoutTransitionRepositoryType,
);

export const payoutService = lazySingleton<PayoutServiceType>(
  () => loadModule('payout.service.core').payoutService as PayoutServiceType,
);
