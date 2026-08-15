# Authentication

Shared authentication capabilities for Xhovile applications.

## Scope

This module owns authentication mechanisms and supporting security workflows. Application-specific screens, routing, product roles, and business authorization remain in the consuming application.

## Initial capability

- Passkeys / WebAuthn

## Planned capabilities

- Two-factor authentication (TOTP)
- Session management
- Account recovery
- Trusted device management

## Integration principle

The authentication layer should expose stable application-facing interfaces while keeping WebAuthn ceremony details, credential persistence, verification, and security checks inside this module.
