# HTTP

Reusable HTTP/server infrastructure for Xhovile applications.

## Purpose

`http/` contains shared HTTP-layer primitives that standardize request/response boundaries without owning application routes or business logic.

## Design goals

- Keep framework-independent HTTP contracts where practical.
- Centralize reusable validation, error, and response behavior.
- Keep application routing and authorization policies in consuming applications.
- Avoid coupling Platform to a particular application's route tree.

## Integration boundary

Applications own route definitions, authentication/authorization policy, business logic, and framework configuration. Platform owns reusable HTTP primitives and adapters.

## Security

HTTP helpers must preserve safe error handling, input validation, explicit content types, and appropriate security headers. Do not expose stack traces, secrets, or provider-specific credentials to clients.

## Current status

**Reusable capability — integration hardening/documentation in progress.**
