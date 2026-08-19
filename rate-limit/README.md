# Rate Limit

Reusable, application-agnostic request rate-limiting capability for Xhovile applications.

## Purpose

`rate-limit/` provides the core rate-limiting contracts and implementations that applications can reuse without sharing the same product infrastructure.

The module separates **policy**, **counter storage**, and **request integration** so each consuming application can choose its own limits and infrastructure.

## Design goals

- Keep rate-limit policy independent from application business rules.
- Allow different applications to use different limits and key strategies.
- Keep storage behind `RateLimitStore` so Redis, memory, or another backend can be used without changing the limiter contract.
- Support application-provided request context such as IP, user ID, and route.
- Make degraded-store behavior explicit through `fail-open` or `fail-closed` policy.
- Avoid assuming that all consuming applications have identical infrastructure.

## Core contract

The module exposes the following concepts:

- `RateLimitPolicy` — defines the request limit and fixed-window duration.
- `RateLimitStore` — persists/increments counters atomically.
- `RateLimitContext` — carries application-provided request identity/context.
- `RateLimitKeyStrategy` — supports `ip`, `user`, `ip+user`, `route`, and `custom` keys.
- `RateLimitResult` — reports allowance, remaining quota, reset time, retry delay, and degraded operation.

The consuming application chooses the policy. Platform supplies the reusable mechanism.

## Integration model

```text
Application request
       ↓
Build RateLimitContext
       ↓
Select application policy
       ↓
Platform RateLimiter
       ↓
RateLimitStore
       ↓
Allow / reject
```

For example, two applications can use the same Platform module while applying completely different policies:

```text
BuyMesho → login: 5 requests / minute / IP
FarmKit  → search: 60 requests / minute / IP+user
```

The policy values belong to the consuming application; they are not global Platform defaults.

## Storage

### Memory

The in-memory store is useful for local development and single-instance deployments where process-local counters are acceptable.

It must not be treated as a shared production counter when an application runs across multiple instances.

### Redis

The Redis adapter provides shared counter storage for horizontally scaled deployments.

The application owns the Redis connection/configuration and decides whether Redis is part of its infrastructure.

## Express integration

`rate-limit/express/` provides the HTTP integration layer for Express applications.

Framework adapters should translate framework-specific requests into the Platform-neutral limiter contract rather than introducing application-specific policies.

## Security and operational requirements

- Rate-limit keys must avoid accidentally exposing raw sensitive identifiers.
- Authentication-sensitive endpoints should normally use user and/or IP-aware policies.
- Rate limiting is an abuse-control layer, not a replacement for authentication, authorization, validation, or fraud controls.
- Production deployments with multiple application instances require a shared store when limits must be globally consistent.
- Store failures must follow an explicit policy; they must never silently change security posture.
- Rejected requests should expose safe retry information without leaking internal storage details.

## BuyMesho extraction boundary

The current Platform rate limiter may originate from BuyMesho, but BuyMesho-specific limits, route names, account models, middleware conventions, and infrastructure must not become part of this module's public contract.

BuyMesho should consume Platform Rate Limit and define its own policies.

## Testing requirements

At minimum, test:

- fixed-window counting
- limit boundaries
- reset timing
- each key strategy
- custom key resolution
- independent policies
- concurrent increments
- memory-store expiry
- Redis-store behavior
- store failure modes
- degraded results
- Express middleware behavior
- multi-application policy isolation

## Current status

**Reusable core implemented — integration hardening in progress.**

The primary extraction goal is to keep the limiter generic while applications retain complete ownership of their rate-limit policies and infrastructure choices.
