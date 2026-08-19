# Authentication

Shared authentication and authorization capabilities for Xhovile applications.

## Scope

This module owns reusable identity-security mechanisms and authorization primitives. Application-specific screens, routing, account models, product roles, and business rules remain in the consuming application.

## Current capabilities

- Passkeys / WebAuthn
- TOTP / authenticator-app two-factor authentication

- Session management

- RBAC / authorization primitives

Each capability has its own README describing its integration boundary and security requirements.

## Integration principle

Capabilities in `auth/` expose stable application-facing interfaces while keeping security-sensitive implementation details inside Platform.

The consuming application remains responsible for identity storage, sessions where application-specific integration is required, account lifecycle, and product-specific authorization policy.
