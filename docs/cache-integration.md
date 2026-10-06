# Cache integration

Xhovile Platform provides two cache implementations that require no external cache service.

## Server-side cache

Import the bounded in-process cache:

~~~ts
import { MemoryCache } from "@xhovile/platform/cache";
~~~

Example:

~~~ts
const cache = new MemoryCache();
~~~

Use cache-aside loading:

~~~ts
const listings = await cache.getOrSet(
  "listings:food-snacks",
  () => loadListingsFromDatabase(),
  { ttlMs: 5 * 60 * 1000 },
);
~~~

A cache hit returns the stored value without executing the loader. Concurrent misses for the same key are coalesced so that several requests arriving at the same time share one loader execution.

Use prefix invalidation after writes:

~~~ts
await cache.invalidate("listings:food-snacks:");
~~~

The memory cache is process-local. It is lost on process restart and is not shared across multiple backend instances. Applications must therefore treat it as a performance optimization, never as durable state.

## Browser-local cache

Import:

~~~ts
import { BrowserCache } from "@xhovile/platform/cache/browser";
~~~

Example:

~~~ts
const cache = new BrowserCache();

const categories = await cache.getOrSet(
  "categories",
  () => fetch("/api/categories").then((response) => response.json()),
  60 * 60 * 1000,
);
~~~

Browser cache data is stored in localStorage, is local to the current browser/device, and can reduce repeated backend requests for stable data. It should only be used for data that is safe to store client-side.

## Cache key and invalidation convention

Use stable, namespaced keys such as:

~~~text
categories:all
listings:category:food-snacks
seller:123
~~~

After a mutation, invalidate the smallest relevant prefix. Do not cache security-sensitive or highly mutable state unless its consistency requirements are explicitly designed.

## Recommended BuyMesho use

Start with public, read-heavy data:

- categories
- public listing/search results
- public seller information
- other data that changes less frequently

Keep payments, orders, inventory, ticket status, payouts, authentication state, and other consistency-sensitive data out of this cache until their specific consistency requirements are designed.
