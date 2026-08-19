# Messaging

Reusable messaging infrastructure for Xhovile applications.

## Purpose

`messaging/` provides shared messaging primitives and server-side delivery boundaries for applications that need to create, route, or deliver messages without coupling Platform to a specific product's UI or business workflow.

## Design goals

- Keep message contracts reusable across applications.
- Keep provider integrations behind adapters.
- Keep recipient identity, product events, templates, and business rules application-owned.
- Support safe server-side delivery and operational error handling.

## Integration boundary

Applications own recipient/account models, message content policy, product-triggering events, preferences, and UI. Platform owns reusable delivery abstractions and provider integration contracts.

## Security

Messaging credentials stay server-side. Validate recipients and content before delivery, avoid leaking provider errors to clients, and prevent unauthorized use of privileged messaging operations.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
