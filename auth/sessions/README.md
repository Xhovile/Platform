# Sessions

Reusable session-management capability for Xhovile applications.

## Purpose

`auth/sessions/` defines the reusable session layer for applications that need authenticated request state without moving the application's identity provider or account model into Platform.

## Design goals

- Keep session lifecycle separate from authentication mechanisms such as Passkeys or TOTP.
- Allow applications to choose their session storage and runtime model through explicit adapters.
- Keep session creation, validation, rotation, expiry, and revocation security-sensitive logic centralized.
- Avoid coupling Platform sessions to Firebase Authentication, browser frameworks, or a specific database.

## Integration boundary

The application owns:

- user/account identity
- authentication provider integration
- session persistence adapter
- cookie/header transport policy
- application authorization and roles
- UI and login/logout routes

Platform Sessions should operate on an application identity/session contract rather than on a product-specific account implementation.

## Lifecycle

```text
Authentication succeeds
        ↓
Create session
        ↓
Send secure session credential
        ↓
Validate on request
        ↓
Rotate/revoke/expire as required
        ↓
Destroy on logout or security event
```

## Security requirements

- Prefer secure, HttpOnly, SameSite-aware cookies for browser sessions where appropriate.
- Session identifiers must be unpredictable and treated as credentials.
- Do not put sensitive account data directly into session tokens unless the design explicitly requires it and protects it appropriately.
- Session expiry and idle timeout policy must be explicit.
- Session revocation must be possible for security-sensitive events.
- Authentication changes such as password reset, factor removal, or account compromise should be able to invalidate affected sessions.
- Session secrets must remain server-side.

## Separation from authentication

Authentication capabilities such as Passkeys and TOTP establish or strengthen identity. Sessions represent the resulting authenticated application state.

```text
Passkeys / TOTP / other authentication
                 ↓
         Platform Sessions
                 ↓
       Application authorization
```

## BuyMesho extraction boundary

BuyMesho-specific Firebase session behavior, account claims, route conventions, and persistence code must remain application-owned. Platform Sessions should expose the reusable lifecycle and validation contract instead.

## Testing requirements

At minimum, test:

- creation and validation
- expiry and idle timeout
- revocation
- rotation
- logout
- invalid/tampered credentials
- concurrent session behavior
- authentication-event invalidation
- storage failures
- cookie/header integration boundaries

## Current status

**Reusable capability — integration hardening/documentation in progress.**
