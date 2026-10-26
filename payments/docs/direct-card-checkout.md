# PayChangu Direct Card Checkout — implementation boundary

## Scope of this first milestone

The Platform payments area now has an isolated, server-side Direct Card Charge adapter foundation. It is separate from the existing Standard Checkout adapter (POST /payment and /verify-payment/{tx_ref}).

Implemented in paychangu.card.ts:

- Separate initiation through POST /charge-card/payments.
- Caller-supplied, stable charge IDs with a generator for new attempts.
- Server-supplied amount/currency and basic card-field validation.
- HTTPS checks for the return URL, an explicit application-owned host allowlist (PAYCHANGU_DIRECT_CARD_RETURN_HOSTS), and PayChangu-owned 3-D Secure authentication URLs.
- Pending/3-D Secure result states; successful initiation is never treated as payment completion.
- Verification through GET /charge-card/verify/{charge_id} with exact amount, currency, and optional returned charge-ID matching.
- Explicit opt-in gates: PAYCHANGU_DIRECT_CARD_ENABLED=true, PAYCHANGU_DIRECT_CARD_PCI_APPROVED=true, and PAYCHANGU_DIRECT_CARD_VALIDATION_CONFIRMED=true, plus PAYCHANGU_DIRECT_CARD_RETURN_HOSTS and PAYCHANGU_DIRECT_CARD_RESULT_HOSTS exact-host allowlists. A concrete, reviewed DirectCardAuthorizationAdapter must also be registered by the consuming application. The validation flag must remain false/unset until PayChangu's validate-charge/3-D Secure contract has been confirmed and implemented. Configure PAYCHANGU_DIRECT_CARD_RETURN_URL for the backend callback and PAYCHANGU_DIRECT_CARD_RESULT_URL for the app's payment-return page.
- Tests cover request mapping, flag gates, 3-D Secure response handling, and verification mismatches. The adapter intentionally returns no raw provider response and does not log or persist PAN/CVV.

## Current integration boundary

The reusable Platform card core now consists of:

- a PayChangu provider adapter for `POST /charge-card/payments` and `GET /charge-card/verify/{charge_id}`;
- app-neutral contracts for server-authoritative order lookup, atomic pending charge/payment creation, verification-state persistence, and idempotent verified settlement;
- an explicit database schema initializer and charge-table repository that receive a database adapter rather than importing BuyMesho's database compatibility module;
- a service orchestrator that depends on those contracts instead of importing BuyMesho-specific order, payment, escrow, or payout modules.

This deliberately removes the attempted product-specific checkout route from the Platform branch. **No application route or buyer-facing card form is connected yet.** The BuyMesho application must provide the store adapter for its existing order/payment/escrow/ticket workflow and a reviewed authorization adapter implementing PayChangu's confirmed validation contract. The store's verified-settlement method must be transactional and idempotent.

New direct-card checkout remains blocked unless the explicit feature, PCI/account-approval, and validation-contract gates are enabled, a concrete authorization adapter is registered, and callback/result URL allowlists are configured. The validation flag is an engineering gate only; it is not proof that the needed endpoint has been implemented or approved.

The charge-table record and payment contract intentionally exclude PAN/CVV and raw card payloads. Card data is sent to the provider adapter for initiation only and must never be written to payment records, logs, analytics, or error monitoring.

## Blocking API contract question

PayChangu's public [Card guide](https://developer.paychangu.com/docs/card) describes a separate validate charge operation for a validation code/3-D Secure OTP, but the linked [Charge a card reference](https://developer.paychangu.com/reference/charge-a-card) and [Verify card charge reference](https://developer.paychangu.com/reference/verify-card-charge) do not identify that endpoint, request shape, or response fields. The guide also shows a 3-D Secure redirect flow and says the return URL receives charge_id and status.

Before wiring the buyer UI or considering the flow complete, PayChangu must confirm whether the hosted 3-D Secure redirect fully replaces an explicit validate call for this integration, or provide the validation endpoint and contract. The initiation example also does not consistently show charge_id in the response, so Platform must continue to persist the ID it generated and sent in the request.

## Compliance and release gate

PayChangu states that PCI DSS compliance is mandatory for Direct Card Charge and that PayChangu must activate the feature for the merchant account. The two environment flags are engineering gates only; they are not evidence of certification or account activation. Production use remains blocked until both are verified by the project owner and PayChangu.

Official references:
- [Card integration guide](https://developer.paychangu.com/docs/card)
- [Charge a card API](https://developer.paychangu.com/reference/charge-a-card)
- [Verify card charge API](https://developer.paychangu.com/reference/verify-card-charge)
- [PayChangu test cards](https://developer.paychangu.com/docs/test)
