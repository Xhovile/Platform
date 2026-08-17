# Xhovile Platform — Payments

## Purpose

`payments/` is the planned reusable payment infrastructure for Xhovile applications.

This module is **documentation-only for now**. It intentionally does not contain an implementation yet.

The first implementation will be extracted from the production payment capabilities currently living in BuyMesho. The extraction should preserve proven behavior first, then harden and generalize the reusable payment core.

## Extraction principle

**Do not modify BuyMesho merely to prepare for extraction.**

BuyMesho remains the source-of-truth implementation until the Payments capability is extracted into Platform. Security and architecture improvements listed here should be implemented as part of the Platform Payments extraction unless an issue is severe enough to require an immediate product-side fix.

The intended flow is:

```text
BuyMesho payment implementation
        ↓
Identify reusable payment contracts
        ↓
Extract into Platform Payments
        ↓
Harden + test the Platform module
        ↓
BuyMesho consumes Platform Payments
```

## Security requirements

### 1. Server-authoritative payment state

The client must never be the authority for financial truth.

The payment layer must calculate or verify server-side:

- order amount
- currency
- fees and commissions
- seller payable amount
- payment status
- settlement status
- payout eligibility
- provider transaction references
- payout destination eligibility

The browser should submit intent or identifiers, not authoritative financial values.

Example:

```text
Client → orderId + payment intent
Platform Payments → fetch order → calculate/verify amount → create provider request
```

### 2. Central request validation

Every payment mutation must pass through a consistent server-side validation boundary.

Required pipeline:

```text
Authenticate
   ↓
Authorize
   ↓
Validate request schema
   ↓
Normalize input
   ↓
Apply idempotency rules
   ↓
Execute payment operation
   ↓
Persist authoritative state
   ↓
Audit
```

Validation must cover at minimum:

- IDs and references
- amounts
- currencies
- provider names
- callback/webhook payloads
- payout destinations
- phone/account identifiers
- metadata and free-text fields

Use strict schemas with explicit length, range, enum, and format constraints. Do not rely on frontend validation.

### 3. Secrets must remain server-side

Payment secrets must never be shipped to browser code.

Examples include:

```text
PAYCHANGU_SECRET_KEY
PAYMENT_WEBHOOK_SECRET
DATABASE_URL
PROVIDER_PRIVATE_KEYS
SIGNING_SECRETS
```

Platform Payments should expose a single validated server-only environment contract, conceptually:

```text
Platform Payments
    ↓
validated server environment
    ↓
provider adapter
```

Client-visible configuration must contain only values that are safe to expose publicly.

### 4. Edge/server boundary

Privileged payment operations should be exposed through server-side or Edge Functions where appropriate.

The browser should never call a payment provider with a private credential.

Recommended boundary:

```text
Browser
   ↓
Payments API / Edge Function
   ↓
Authentication + validation + authorization
   ↓
Payment service
   ↓
Provider adapter
   ↓
Payment gateway
```

Do not move every database operation to Edge by default. Select the runtime according to the workload and provider/database requirements.

### 5. Webhook authenticity and replay protection

Provider callbacks must never be trusted solely because they reach a public endpoint.

Each provider adapter must define:

- signature/authenticity verification
- timestamp tolerance where supported
- replay protection
- event-id/idempotency handling
- payload validation
- safe acknowledgement behavior

Webhook state changes must be based on authenticated provider evidence and current server state.

### 6. Idempotency

All payment and payout operations that can create financial side effects must support idempotency.

At minimum:

```text
Checkout creation
Payment creation
Refunds
Payout requests
Payout retries
Webhook event processing
```

The idempotency key must be scoped correctly to the operation and actor/context so unrelated requests cannot collide.

### 7. Provider response verification

Do not treat a successful HTTP response as proof that a payment or payout is complete.

The payment layer should distinguish at least:

```text
request accepted
provider processing
provider completed
settled
failed
reversed
unknown / requires reconciliation
```

Where provider APIs support transaction lookup, the Platform layer should be able to re-query the provider before making irreversible state transitions when needed.

### 8. Settlement-aware payouts

Payments and payouts must model settlement separately from checkout success.

For providers using delayed settlement such as T+1:

```text
Payment received
      ↓
Provider settlement pending
      ↓
Funds settled
      ↓
Payout becomes eligible
      ↓
Payout submitted
```

The Platform module must not assume that a successful payment immediately creates withdrawable funds.

Automatic payout scheduling must therefore use authoritative settlement state rather than wall-clock assumptions alone.

### 9. Payout destination security

Payout destinations require explicit lifecycle states such as:

```text
unverified
pending verification
verified
inactive
replaced
blocked
```

A payout must never be submitted solely because a destination identifier exists.

The service should verify that the destination is:

- owned by the intended seller/account
- verified
- active
- supported by the selected provider
- eligible for the requested currency and payout method

### 10. Rate limiting and abuse controls

Payment endpoints require stronger abuse controls than ordinary application endpoints.

Apply appropriate controls to:

- checkout creation
- payment status polling
- payout requests
- payout destination changes
- refund initiation
- webhook endpoints where useful

Rate limits should be paired with authentication, authorization, idempotency, and fraud/risk controls rather than treated as a standalone defense.

### 11. Financial auditability

Every material financial transition should be traceable.

Audit records should preserve enough information to answer:

- who initiated the action
- what was requested
- what the server calculated
- which provider was used
- provider reference IDs
- state transitions
- timestamps
- retry/reconciliation activity
- final outcome

Never log secret credentials or unnecessary sensitive payment data.

### 12. Data minimization

Platform Payments should store and expose only the payment data required for operation, reconciliation, support, and legal/compliance needs.

Avoid persisting raw provider credentials, unnecessary card data, or secrets.

Where identifiers must be displayed operationally, prefer masked representations.

### 13. Provider abstraction

Provider-specific logic should live behind a stable adapter contract.

Conceptually:

```text
PaymentService
   ├── PayChanguAdapter
   ├── FutureProviderAdapter
   └── FutureProviderAdapter
```

Application code should depend on Platform payment contracts rather than directly depending on a specific gateway.

Provider adapters should own:

- request mapping
- authentication
- signatures
- webhook verification
- provider status mapping
- provider-specific retry behavior
- provider error normalization

### 14. Reconciliation

The Platform Payments module must support reconciliation as a first-class capability.

It should be possible to identify states such as:

```text
internal paid / provider unknown
provider paid / internal pending
internal payout processing / provider unknown
provider payout complete / internal processing
settlement expected / settlement not observed
```

Reconciliation should be safe, auditable, and idempotent.

### 15. Error handling

Payment errors should be classified rather than exposed as raw provider responses.

Use categories such as:

```text
validation
authentication
authorization
provider_rejected
provider_unavailable
timeout
settlement_pending
reconciliation_required
internal_error
```

Return safe user-facing messages while preserving structured diagnostic information server-side.

## Testing requirements for extraction

When this module is implemented, it should include tests for at least:

- schema validation
- authorization boundaries
- amount tampering
- currency mismatch
- duplicate requests
- duplicate webhooks
- webhook signature failures
- webhook replay
- provider timeout handling
- provider retry behavior
- provider status re-query
- T+1 settlement behavior
- payout eligibility
- destination verification
- payout idempotency
- reconciliation
- audit logging
- secret/configuration validation

Financial-integrity tests must be mandatory for changes affecting payment or payout state.

## BuyMesho extraction checklist

Before replacing BuyMesho's payment implementation with Platform Payments:

- [ ] Define provider-neutral payment contracts.
- [ ] Extract PayChangu-specific behavior into an adapter.
- [ ] Extract payment/payout state machines.
- [ ] Extract idempotency behavior.
- [ ] Extract webhook verification and replay handling.
- [ ] Extract settlement-aware payout eligibility.
- [ ] Extract reconciliation logic.
- [ ] Extract server-only environment configuration.
- [ ] Add comprehensive payment security tests.
- [ ] Run BuyMesho and Platform side-by-side before cutover.
- [ ] Switch BuyMesho to Platform Payments only after behavior and financial totals match.

## Current status

**Documentation only — implementation intentionally deferred.**

This README is the security and architecture contract for the future Platform Payments module. New payment-related security findings from BuyMesho should be added here rather than prematurely implemented in BuyMesho when they are intended to be solved during extraction.
