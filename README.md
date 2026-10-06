# Xhovile Platform

Shared, production-ready infrastructure for Xhovile applications.

## What this repository is

\`Xhovile/Platform\` is the home for reusable application infrastructure that should be built once, tested independently, and consumed by multiple Xhovile products.

Applications should provide their own UI, identity/account integration, storage adapters, and product-specific configuration. Platform capabilities must remain application-agnostic.

## Current capabilities

### Authentication → Passkeys / WebAuthn

Passkeys are a production capability in Platform.

The reusable Passkey package lives under:

~~~text
auth/passkeys/
~~~

It provides the WebAuthn ceremony and verification layer for:

- discoverable/passwordless authentication
- passkey registration
- passkey authentication
- credential verification
- challenge/ceremony handling
- browser helpers
- server-side verification contracts

The implementation uses SimpleWebAuthn and is intentionally independent of BuyMesho.

### Authentication → OTP

OTP is a reusable one-time-password capability available through:

~~~text
auth/otp/
~~~

Public consumers import it from:

~~~ts
import { issueOtp, verifyOtp } from "@xhovile/platform/otp";
~~~

The module provides:

- secure OTP generation and hashing
- challenge expiry and attempt semantics
- single-use verification
- application-owned persistence contracts
- delivery-provider contracts
- shared rate-limit integration
- WhatsApp delivery through a concrete provider

The application remains responsible for identity mapping, challenge storage implementation, rate-limit policy, delivery credentials/template configuration, and sessions.

### Caching

Platform provides an infrastructure-free in-process TTL cache through:

~~~text
@xhovile/platform/cache
~~~

The cache provides:

- get, set, has, delete
- getOrSet for cache-aside loading
- prefix invalidation
- TTL expiry
- bounded memory with LRU-style eviction
- concurrent miss coalescing

The implementation stores values in the application's process memory. It does not require Redis, a separate database, a separate server, or a third-party cache provider.

For browser applications, Platform also provides:

~~~text
@xhovile/platform/cache/browser
~~~

This uses browser localStorage with TTL metadata. Browser entries remain local to the user's device and are not shared with other users or backend instances.

Neither cache is a source of truth. Applications must always be able to reload the underlying data when a cache entry is absent or expired.

### BuyMesho integration

BuyMesho is a consumer of Platform authentication capabilities.

~~~text
BuyMesho
   ↓
Xhovile Platform authentication capability
   ↓
verification
   ↓
BuyMesho identity/storage
   ↓
Firebase account/session
~~~

BuyMesho-specific concerns such as Firebase identity, sessions, UI, and database adapters stay in BuyMesho rather than being moved into Platform.

## What is intentionally not in Platform

Platform must not contain BuyMesho-specific UI, Firebase account logic, product routes, or application-specific business rules.

## Planned capabilities

~~~text
Platform/
├── auth/
│   ├── passkeys/
│   ├── otp/
│   ├── TOTP/
│   ├── sessions/
│   └── recovery/
├── payments/
├── messaging/
├── notifications/
└── shared/
~~~

These areas should be added when working implementations are extracted from products or when a capability has a clear reusable interface.

## Working principle

**Extract before rewrite.**

When a capability already works in a production application, move the reusable core into Platform carefully, stabilize it with tests and documentation, then make the application consume Platform instead of duplicating the implementation.

## Status

Passkeys: **Production integration in BuyMesho — complete for the current scope.**

OTP: **Reusable core, storage/delivery contracts, rate-limit integration, and WhatsApp provider implemented; consumer integration remains application-specific.**

Cache: **Infrastructure-free in-process server cache and browser-local cache implemented; application integration remains product-specific.**
