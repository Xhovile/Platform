# Xhovile Platform

Shared, production-grade infrastructure for Xhovile applications.

## Purpose

This repository contains reusable capabilities that should be implemented once, tested independently, and consumed by multiple Xhovile products.

The first capability being developed is authentication with passkeys.

## Principles

- Reusable: platform code must not depend on a specific application such as BuyMesho.
- Modular: each capability has a clear boundary and interface.
- Production-first: security, testing, observability, recovery, and documentation are part of the implementation.
- Extract before rewrite: proven implementations from existing applications should be moved here carefully rather than unnecessarily rewritten.
- Application-agnostic: consumers provide application-specific configuration and UI.

## Planned capabilities

- Authentication
  - Passkeys / WebAuthn
  - Two-factor authentication
  - Sessions
  - Account recovery
- Payments
- Messaging
- Notifications
- Shared utilities

## Current priority

### Passkeys

Passkeys are the first Platform capability. The implementation will be designed so that BuyMesho can consume it first and future Xhovile applications can reuse the same authentication foundation.
