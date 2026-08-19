# TOTP

Time-based one-time password (TOTP) authentication capability for Xhovile applications.

## Purpose

`auth/TOTP/` provides the reusable TOTP security layer for applications that need authenticator-app-based two-factor authentication.

The module owns the TOTP mechanism and security-sensitive verification logic. The consuming application owns the user account, session, UI, persistence policy, and product-specific authorization.

## Design goals

- Keep TOTP generation and verification independent of application UI.
- Keep user/account identity in the consuming application.
- Require an explicit application-owned storage adapter for TOTP state.
- Support secure enrollment, verification, disable/recovery workflows, and replay protection where applicable.
- Avoid coupling the module to Firebase, PostgreSQL, or another product-specific identity system.

## Integration boundary

The application should provide or own:

- account/user identity
- encrypted TOTP secret storage
- enrollment state
- enabled/disabled state
- session/authentication state
- recovery-code policy and storage, if used
- rate limiting and abuse controls
- audit logging

Platform TOTP should return authentication results and security signals rather than creating application sessions itself.

## Security requirements

- TOTP secrets must never be exposed to browser logs, analytics, or application logs.
- Secrets must be encrypted at rest using application-controlled key management.
- Verification endpoints must be rate-limited and protected against brute force.
- Enrollment must require an authenticated, authorized account context.
- Verification should reject malformed codes before attempting cryptographic verification.
- Clock-drift handling must be explicit and conservative.
- Secret replacement and disabling must invalidate the previous enrollment according to the application's policy.
- Recovery flows must not silently weaken the second-factor requirement.

## Consumer integration

Typical flow:

```text
Application account
      ↓
Platform TOTP enrollment
      ↓
Application-owned encrypted secret storage
      ↓
User configures authenticator app
      ↓
Platform TOTP verification
      ↓
Application decides whether to complete/upgrade the session
```

## BuyMesho extraction

BuyMesho is an extraction source, not a dependency of this module.

Any BuyMesho-specific account model, Firebase Authentication integration, routes, UI, or database implementation must remain outside Platform TOTP.

## Runtime and dependencies

The module should remain server-oriented for secret handling. Client-side code must never receive the TOTP secret after enrollment has been completed.

## Testing requirements

At minimum, test:

- valid and invalid codes
- expired codes
- clock-drift policy
- malformed input
- enrollment state transitions
- disabled/replaced secrets
- brute-force/rate-limit interaction
- secret-storage failures
- replay or duplicate verification behavior where applicable
- application/session integration boundaries

## Current status

**Reusable module — integration hardening/documentation in progress.**

The module should be considered application-agnostic only when no BuyMesho-specific identity, storage, or session assumptions remain in its public contract.
