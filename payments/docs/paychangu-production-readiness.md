# PayChangu Production-Readiness Plan

This document turns the current PayChangu integration findings into an implementation plan that is safe for production.

**Status note:** this is a readiness and rollout plan, not a declaration that the PayChangu payment layer is completely finished. Full rollout still depends on the route-wiring, configuration validation, raw-body webhook security, idempotency, automated testing, monitoring, and reconciliation checks listed below.

## 1) Route wiring and endpoint contract

Define a single source of truth for server routes and keep frontend constants aligned:

- `POST /api/payments/paychangu/initialize`
- `GET /api/payments/paychangu/verify/:txRef`
- `POST /api/payments/paychangu/webhook`
- `POST /api/payments/paychangu/refund` (optional if supported)

Implementation requirements:

1. Mount payment router in `server.ts`.
2. Add typed request/response contracts shared by frontend and server.
3. Fail CI when frontend endpoint constants diverge from server route definitions.

## 2) Environment and configuration wiring

Required env vars (server-side only):

- `PAYCHANGU_SECRET_KEY`
- `PAYCHANGU_WEBHOOK_SECRET`
- `PAYCHANGU_BASE_URL` (default to PayChangu API base)
- `PAYMENTS_PROVIDER=paychangu`

Rules:

- Validate on boot (zod/envalid).
- Crash fast on missing required keys in production.
- Never expose secrets to `VITE_*` client vars.

## 3) Webhook security and correctness

Webhook route must use raw body for HMAC verification.

Implementation requirements:

1. Add raw-body middleware on webhook route only.
2. Verify signature from exact header required by PayChangu docs.
3. Use timing-safe compare.
4. Reject replayed events (idempotency store by provider event ID).
5. Process only expected event types and terminal statuses.
6. Validate amount/currency/reference against locally stored order.

## 4) Payment verification hardening

`verifyPayment` must not treat any 2xx as success.

Implementation requirements:

- Map provider response to explicit states: `pending`, `succeeded`, `failed`, `canceled`.
- Accept success only when provider status is terminal success and amount/currency/reference all match local records.
- Persist full provider payload for audits.

## 5) Persistence model (no in-memory maps)

Create durable tables:

- `orders`
- `payments`
- `payment_events`
- `refunds` (optional)

Minimum fields:

- Provider transaction ref, internal order id, user id, amount, currency, provider status, internal status, created/updated timestamps.
- Unique constraints on provider transaction/event IDs.
- Indexes on `(order_id)`, `(provider_tx_ref)`, `(status)`.

## 6) Idempotency and consistency

- Require idempotency key on initialize endpoint.
- Store key + response fingerprint.
- Webhook and verify flows should converge through a single state-transition service.
- Use transaction boundaries for order+payment updates.

## 7) Refund behavior

- If PayChangu supports refunds: implement provider adapter + refund states.
- If not: disable refund endpoint for PayChangu and return explicit `501 not_supported` with actionable message.
- Do not silently route PayChangu refunds through another provider.

## 8) Observability and operations

- Structured logs with `request_id`, `order_id`, `tx_ref`, `event_id`.
- Metrics: init count, verify success/fail, webhook signature failures, replay rejects, settlement lag.
- Alerts on signature-failure spikes and stuck `pending` payments.

## 9) Testing strategy

Add automated tests:

1. Unit: signature verification, status mapping, transition guards.
2. Integration: initialize → verify → webhook reconciliation with mocked provider.
3. E2E smoke: authenticated user flow with deterministic fixtures.
4. Negative cases: tampered signature, mismatched amount/currency, duplicate event, stale txRef.

## 10) Rollout plan

1. Ship behind feature flag (`PAYMENTS_PROVIDER=paychangu`).
2. Run in shadow mode (log-only verification) for a pilot window.
3. Enable for a small user cohort.
4. Full rollout after error budget and reconciliation checks pass.

## Suggested implementation order

1. Schema + migrations
2. Config validation
3. Route wiring + shared endpoint constants
4. Verify endpoint hardening
5. Webhook raw-body verification + idempotency
6. End-to-end tests and runbook

