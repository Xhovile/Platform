# AI

Reusable AI infrastructure for Xhovile applications.

## Purpose

`ai/` provides shared server-side AI primitives and provider integration boundaries so consuming applications do not duplicate model access, configuration, and common AI infrastructure.

## Design goals

- Keep provider credentials and privileged model calls server-side.
- Expose application-facing contracts instead of provider-specific details where practical.
- Keep prompts, business rules, UI, and product-specific workflows in the consuming application.
- Make model/provider changes possible without rewriting every consumer.

## Integration boundary

The application owns:

- product-specific prompts and workflows
- authorization for AI features
- user/account context
- user-visible UI
- application-specific cost/usage policy

Platform owns reusable provider plumbing and shared AI service contracts.

## Security

- API keys and provider credentials never enter client bundles.
- Validate and constrain model input at the server boundary.
- Do not expose provider errors or secrets directly to users.
- Apply application-specific authorization and usage limits before privileged model calls.
- Log only the minimum information required for diagnostics and billing/usage tracking.

## BuyMesho extraction boundary

BuyMesho-specific prompts, routes, feature flags, UI, and business workflows must not become dependencies of the Platform AI module.

## Testing requirements

Test provider configuration, request validation, provider failures, timeout/retry behavior, authorization boundaries, and deterministic normalization of provider responses.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
