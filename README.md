# Xhovile Platform

Shared, production-ready infrastructure for Xhovile applications.

## What this repository is

`Xhovile/Platform` is the home for reusable application infrastructure that should be built once, tested independently, and consumed by multiple Xhovile products.

Applications should provide their own UI, identity/account integration, storage adapters, and product-specific configuration. Platform capabilities must remain application-agnostic.

## Current capability

### Authentication → Passkeys / WebAuthn

Passkeys are the first production capability in Platform.

The reusable Passkey package lives under:

```text
auth/passkeys/
```

It provides the WebAuthn ceremony and verification layer for:

- discoverable/passwordless authentication
- passkey registration
- passkey authentication
- credential verification
- challenge/ceremony handling
- browser helpers
- server-side verification contracts

The implementation uses SimpleWebAuthn and is intentionally independent of BuyMesho.

### BuyMesho integration

BuyMesho is the first consumer of Platform Passkeys.

```text
BuyMesho UI
    ↓
Xhovile Platform Passkeys
    ↓
WebAuthn verification
    ↓
BuyMesho PostgreSQL credential/challenge storage
    ↓
Firebase account/session
```

BuyMesho-specific concerns such as Firebase identity, sessions, UI, and database adapters stay in BuyMesho rather than being moved into Platform.

## Current Passkey behavior

- A logged-in user can be offered Passkey setup after normal authentication.
- A user with an existing BuyMesho Passkey is not offered setup again.
- BuyMesho currently enforces one active Passkey per account.
- Passwordless `Sign in with passkey` is supported.
- WebAuthn origins support both `https://buymesho.app` and `https://www.buymesho.app`.
- Logout performs a full page reload before returning to login so the next Passkey ceremony starts from a clean document state.
- Settings contains the Passkey setup entry point; credential replacement/removal management is intentionally not yet implemented.

## What is intentionally not in Platform

Platform must not contain BuyMesho-specific UI, Firebase account logic, product routes, or application-specific business rules.

## Planned capabilities

```text
Platform/
├── auth/
│   ├── passkeys/
│   ├── 2fa/
│   ├── sessions/
│   └── recovery/
├── payments/
├── messaging/
├── notifications/
└── shared/
```

These areas should be added when working implementations are extracted from products or when a capability has a clear reusable interface.

## Working principle

**Extract before rewrite.**

When a capability already works in a production application, move the reusable core into Platform carefully, stabilize it with tests and documentation, then make the application consume Platform instead of duplicating the implementation.

## Status

Passkeys: **Production integration in BuyMesho — complete for the current scope.**

Next major Platform work: extract and stabilize the next genuinely reusable capability from Xhovile applications (2FA, payments, messaging, notifications, etc.).
