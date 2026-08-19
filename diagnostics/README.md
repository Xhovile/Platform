# Diagnostics

Shared diagnostics and operational observability helpers for Xhovile applications.

## Purpose

`diagnostics/` provides reusable instrumentation and diagnostic primitives for identifying failures, performance problems, and operational state across consuming applications.

## Design goals

- Keep diagnostics independent of application UI.
- Provide structured server-side signals rather than ad-hoc logging.
- Avoid leaking secrets or unnecessary user data.
- Allow applications to choose their logging/monitoring destination.

## Integration boundary

The consuming application owns provider-specific logging configuration, alerting, dashboards, retention, and product-specific context. Platform supplies reusable diagnostic structures and helpers.

## Security

Diagnostics must treat logs and telemetry as sensitive operational data. Never record credentials, raw authentication secrets, private keys, or unnecessary personal/payment information.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
