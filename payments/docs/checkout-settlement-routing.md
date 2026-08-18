# Checkout settlement routing

BuyMesho uses one buyer-facing checkout screen with two internal settlement routes.

## Buyer-facing options

The buyer should only see simple choices:

- Pay and confirm later
- Pay directly to seller

## Internal settlement routes

These map to two separate backend flows:

### 1) Escrow

- Buyer pays into BuyMesho's escrow flow.
- BuyMesho holds the funds until delivery is confirmed.
- After confirmation, the seller is paid out through the existing release process.

### 2) Connect

- Buyer pays through PayChangu Connect.
- The seller receives the money directly in their connected PayChangu account.
- BuyMesho records commission separately.

## Implementation rule

The platform must not mix these flows in the same payout logic.

- Escrow orders must wait for delivery confirmation before any release.
- Connect orders must bypass escrow release and go to the seller's connected account flow.
- Commission handling must remain separate from seller settlement routing.

## Code-level expectation

The settlement choice should be represented explicitly in the order and checkout payloads as:

- `escrow`
- `connect`

That keeps the buyer experience simple while preserving separate backend rules for release timing, destination of funds, and commission handling.
