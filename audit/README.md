# Audit

Shared audit-event infrastructure for Xhovile applications.

## Purpose

`audit/` provides reusable mechanisms and contracts for recording security- and business-significant events without coupling Platform to a specific application's database or user model.

## Design goals

- Record authoritative security and operational events at server boundaries.
- Keep audit storage behind an application-provided persistence boundary.
- Preserve enough context for investigation without logging secrets or unnecessary sensitive data.
- Keep product-specific event names and business semantics owned by the consuming application.

## Integration boundary

Applications own:

- actor/user identity mapping
- retention policy
- storage adapter
- product-specific event taxonomy
- compliance requirements

Platform provides reusable audit-event structure and emission behavior.

## Security requirements

Never store passwords, private keys, access tokens, TOTP secrets, or other credentials in audit records. Prefer stable identifiers, event metadata, timestamps, and outcome information.

Audit events should be emitted from trusted server-side boundaries, not from client claims alone.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
