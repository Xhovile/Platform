# Notifications

Reusable notification infrastructure for Xhovile applications.

## Purpose

`notifications/` provides shared notification delivery primitives while leaving product-specific events, preferences, content, and user interfaces to consuming applications.

## Design goals

- Separate notification intent from provider delivery.
- Keep provider-specific integrations behind adapters.
- Allow applications to define their own notification policies and channels.
- Keep recipient identity and preference data application-owned.

## Integration boundary

Applications own notification preferences, templates/content policy, event triggers, recipient/account models, and UI. Platform owns reusable delivery contracts, provider adapters, and normalized delivery outcomes.

## Security

Provider credentials remain server-side. Validate recipient context and authorization before sending privileged notifications. Never use notifications as an authorization mechanism.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
