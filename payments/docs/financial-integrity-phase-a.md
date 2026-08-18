# BuyMesho — Financial Integrity Gate (Phase A)

## Scope

This phase audits only the financial chain:

`Payment → Order → Escrow → Refund → Payout`

Out of scope: UI work, general refactoring, performance optimization, unrelated correctness work.

## Financial invariants

### 1. Payment settlement

A payment may become financially settled only when:

- the stored payment reference matches the provider transaction reference;
- the payment belongs to the expected order;
- currency matches the order currency exactly;
- provider amount matches the authoritative order total exactly;
- provider status is a confirmed captured/success state.

An amount mismatch is not automatic settlement. It must remain recoverable without mutating order, escrow, or payout financial state.

### 2. Escrow

For an escrow settlement:

`escrow.credit = authoritative settled order amount`

The escrow balance must never be based on an unchecked client amount or an unchecked provider amount that differs from the order total.

### 3. Refund

A refund may not exceed the captured/held amount.

A refund cannot occur after an escrow release, and a release cannot occur after a refund.

The local refund state must correspond to an actual provider/customer-money refund capability. A local `refunded` state by itself is not proof that customer funds were returned.

### 4. Payout

For escrow settlement, payout gross amount must equal the escrow release amount.

For direct/connect settlement, payout gross amount must be derived from the authoritative settled order/payment amount, not an unchecked provider amount.

A payout destination must belong to the order seller and be active + verified.

Only one money-releasing payout may exist for a given order/escrow settlement.

## Strict change rule

No production code change in this phase unless the change has:

- a named financial bug,
- specific file(s),
- an explicit invariant,
- and a regression test proving the fix.

## Exit gate

- [x] Exact payment amount/currency invariant enforced
- [x] Overpayment regression implemented
- [x] Underpayment regression implemented
- [x] Escrow amount protected by authoritative order total
- [x] Payout amount protected by authoritative settlement source
- [x] Refund/release mutual exclusion protected
- [x] Provider refund capability cannot be falsely represented locally
- [ ] Full financial integration suite runtime verification

**Implementation work is complete; final green status depends on executing the integration suite in the project environment.**
