# Media

Reusable media/file handling infrastructure for Xhovile applications.

## Purpose

`media/` provides shared primitives for handling application media while keeping product-specific storage providers, access policies, and UI outside Platform.

## Design goals

- Keep storage-provider details behind explicit boundaries.
- Separate media metadata from product business entities.
- Support secure upload/download workflows without exposing privileged credentials.
- Keep application ownership and authorization decisions in the consuming application.

## Integration boundary

Applications own storage configuration, ownership rules, product metadata, UI, and authorization. Platform provides reusable media-handling contracts and secure server-side integration points.

## Security

Validate content type, size, ownership, and access before accepting or serving media. Avoid trusting client-provided filenames or MIME types as authoritative security signals. Do not expose storage credentials to browsers.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
