# BuyMesho Payout Launch Contract Summary

This document clarifies the operational launch scope for the BuyMesho payout system.

It exists to separate:
- launch-complete functionality,
- intentionally deferred work,
- and future operational enhancements.

The payout structure on the `copilot/normalize-admin-override-behavior` branch is considered operationally launch-ready within the frozen scope below.

See `docs/structure-completion-gate.md` for the full frozen checklist and the item-by-item launch gate status.

---

# Launch-complete areas

The following areas are considered complete for the current payout launch scope:

- Seller net payout formula
- 3% platform fee enforcement
- 6% reserve cap enforcement
- Provider-fee ingestion into payout calculations
- Manual adjustment APIs
- Payout financial snapshot persistence
- Payout recalculation audit history
- Eligibility gating
- Retry policy enforcement
- Technical-failure-only retry rules
- Retry limit enforcement
- Manual review escalation paths
- Hold-state enforcement
- Seller payout destination lifecycle
- Server-side payout calculation
- Admin payout override actions
- Admin-only payout authority
- Seller/admin payout operational visibility
- Audit event emission
- Retry audit tracking
- Escrow-to-payout audit linkage
- Payout lifecycle state tracking
- Duplicate webhook protection
- Duplicate release protection
- Seller self-trigger protection
- Retry tests and payout regression coverage
- Adjustment recalculation regression coverage

---

# Explicitly deferred items

The following items are intentionally deferred from the launch contract.

These are future operational improvements and do not block the current payout implementation.

## Deferred risk infrastructure

- Fraud-engine integration
- Dynamic risk scoring
- Category-specific reserve policies
- First-time seller reserve multipliers

## Deferred operational infrastructure

- Long-term payout archive policy
- Advanced provider reconciliation tooling
- Circuit-breaker orchestration for prolonged provider downtime
- Advanced concurrent retry deduplication at route level
- Full downstream provider-failure simulation after escrow release
- Signed/manual adjustment approval workflows

---

# Canonical admin override contract

The canonical admin payout actions are:

- hold
- retry
- mark_paid
- mark_failed
- cancel

All payout override actions must:
- require admin authorization,
- emit audit events,
- include actor attribution,
- include timestamps,
- include reason metadata,
- and follow valid payout state transitions.

Frontend visibility never grants payout authority.

---

# Operational visibility expectations

## Seller visibility

The seller payout experience must expose:

- payout status,
- destination verification state,
- hold/review state,
- retry eligibility,
- failure reason,
- remediation guidance,
- and payout lifecycle visibility.

## Admin visibility

The admin payout experience must expose:

- payout queue state,
- retry attempts,
- retry eligibility,
- provider failure details,
- audit summaries,
- hold reasons,
- manual-review reasons,
- destination verification blockers,
- adjustment history,
- payout recalculation visibility,
- and escalation state.

---

# Final launch interpretation

The payout system should now be treated as:

- operationally structured,
- policy-frozen for launch,
- audit-capable,
- retry-governed,
- financially traceable,
- and administratively controllable.

Remaining deferred items are phase-2 maturity improvements, not launch blockers.
