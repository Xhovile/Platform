# Xhovile Platform

Shared, production-ready infrastructure for Xhovile applications.

## What this repository is

Xhovile/Platform is the home for reusable application infrastructure that should be built once, tested independently, and consumed by multiple Xhovile products.

Applications should provide their own UI, identity/account integration, storage adapters, and product-specific configuration. Platform capabilities must remain application-agnostic.

## Current capabilities

### Authentication → Passkeys / WebAuthn

Passkeys are a production capability in Platform.

The reusable Passkey package lives under:

\`auth/passkeys/\`

It provides the WebAuthn ceremony and verification layer for passwordless authentication, passkey registration, authentication, credential verification, challenge handling, browser helpers, and server-side verification contracts.

### Authentication → OTP

OTP is a reusable one-time-password capability available through:

\`auth/otp/\`

Public consumers import it from:

\`import { issueOtp, verifyOtp } from "@xhovile/platform/otp";\`

The module provides secure OTP generation and hashing, challenge expiry and attempt semantics, single-use verification, application-owned persistence contracts, delivery-provider contracts, shared rate-limit integration, and WhatsApp delivery.

The consuming application remains responsible for identity mapping, challenge persistence implementation, rate-limit policy, delivery credentials/template configuration, and sessions.

### Caching

Platform provides an infrastructure-free in-process TTL cache through:

\`@xhovile/platform/cache\`

The cache provides:

- get, set, has, delete
- getOrSet for cache-aside loading
- prefix invalidation
- TTL expiry
- bounded memory with LRU-style eviction
- concurrent miss coalescing

The implementation stores values in the application's process memory. It does not require Redis, a separate database, a separate server, or a third-party cache provider.

For browser applications, Platform also provides:

\`@xhovile/platform/cache/browser\`

This uses browser \`localStorage\` with TTL metadata. Browser entries remain local to the user's device and are not shared with other users or backend instances.

Neither cache is a source of truth. Applications must always be able to reload the underlying data when a cache entry is absent or expired.

### BuyMesho integration

BuyMesho is a consumer of Platform capabilities.

BuyMesho-specific concerns such as Firebase identity, sessions, UI, database adapters, and product routes stay in BuyMesho rather than being moved into Platform.

## What is intentionally not in Platform

Platform must not contain BuyMesho-specific UI, Firebase account logic, product routes, or application-specific business rules.

## Working principle

**Extract before rewrite.**

When a capability already works in a production application, move the reusable core into Platform carefully, stabilize it with tests and documentation, then make the application consume Platform instead of duplicating the implementation.

## Status

Passkeys: **Production integration in BuyMesho — complete for the current scope.**

OTP: **Reusable core, storage/delivery contracts, rate-limit integration, and WhatsApp provider implemented; consumer integration remains application-specific.**

Cache: **Infrastructure-free in-process server cache and browser-local cache implemented; application integration remains product-specific.**
