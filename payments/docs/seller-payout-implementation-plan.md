# Seller payout implementation plan

_Last reviewed: 2026-05-18_

## Current state in BuyMesho

Buyer payments are already represented in the local payment and escrow flow:

1. PayChangu checkout/webhook verification updates the payment row to `captured`.
2. The matching order is confirmed and moved into `in_escrow`.
3. An escrow record is created with state `funded` and a credit ledger entry for the paid amount.
4. Buyer/admin release changes the escrow state to `released`, appends a release ledger entry, creates one local payout candidate for the released escrow in `pending_settlement`, moves the order status to `fulfilled`, and leaves PayChangu submission to the settlement worker after midnight/T+1 when funds are expected to be usable.

The payout path creates provider-attempt history only after settlement, submits PayChangu payout requests from the scheduler/worker, verifies payout webhooks, and reconciles PayChangu payout status. Release-time never fires the provider payout immediately; seller receipt is finalized by the settlement worker, PayChangu callbacks, reconciliation, and any required manual-review or retry handling rather than guaranteed at the instant escrow is released.

## Scope alignment

This plan follows the frozen decisions in `docs/structure-completion-gate.md` and the launch interpretation in `docs/payout-launch-contract-summary.md`.

The launch scope covers:

- seller net payout formula,
- 3% platform fee,
- 6% reserve cap,
- provider-fee ingestion into payout calculations,
- manual adjustment APIs,
- payout financial snapshot persistence,
- payout recalculation audit history,
- eligibility gating,
- technical-failure-only retries,
- admin override normalization,
- audit coverage,
- seller/admin visibility,
- and regression-tested payout behavior.

The intentionally deferred Phase 2 items (//The payout rules are no longer changing, Seller payout path is live and working end-to-end) are:

- signed/manual adjustment approval workflows,
- fraud-engine integration,
- dynamic risk scoring,
- category-specific reserve policies,
- first-time seller reserve multipliers,
- long-term payout archive policy,
- advanced provider reconciliation tooling,
- circuit-breaker orchestration for prolonged provider downtime,
- advanced concurrent retry deduplication at route level,
- and full downstream provider-failure simulation after escrow release.

## PayChangu source links

These PayChangu docs should stay linked in this plan because they define the payout capabilities and operational constraints that the backend implementation depends on:

- [Disbursements introduction](https://developer.paychangu.com/docs/introduction-2): PayChangu describes transfers/payouts from the available balance to bank accounts and mobile money wallets, including core fields such as `amount`, `currency`, destination identifiers, recipient account details, and a unique `charge_id`.
- [Mobile Money Payout API](https://developer.paychangu.com/reference/mobile-money-payout): documents the mobile money payout endpoint (`POST /mobile-money/payouts/initialize`) and required fields such as `mobile`, `mobile_money_operator_ref_id`, `amount`, and unique `charge_id`.
- [Bank Account payout guide](https://developer.paychangu.com/docs/bank-account): documents bank payout setup, KYC/feature activation prerequisites, sample `POST /direct-charge/payouts/initialize` payloads, and transfer status verification through the status endpoint or webhooks.
- [Wallet balance guide](https://developer.paychangu.com/docs/balance): documents `GET /wallet-balance?currency=MWK` and the distinction between `collection_balance` and `main_balance`, which matters because payouts are made from funds available to transfer out.

## Important pre-merge notes

Before treating the production payout implementation as complete, resolve these remaining product and safety details. Items marked **Resolved for release-time dispatch** are covered by the current escrow-release path, which creates the payout candidate and attempts PayChangu submission; they still need to be preserved as the payout stack is hardened.

| Status | Note | Required pre-merge edit |
| --- | --- | --- |
| **Resolved for release-time dispatch** | Escrow release authorization must stay buyer/admin-only. | Keep release endpoints on the dedicated buyer/admin release access check; do not reuse general order access for release or payout-triggering routes. Add/keep regression coverage that sellers cannot release escrow for their own orders. |
| **Resolved for settlement-queued dispatch** | Escrow release must be an accounting event, not just a status flip. | Preserve the transactional release ledger entry, one payout candidate per escrow in `pending_settlement`, the approved seller-net formula, and worker-driven PayChangu dispatch after settlement using the seller's verified payout destination. |
| **Resolved for launch scope** | Separate escrow idempotency from provider-attempt idempotency. | Keep payout-candidate uniqueness at the escrow/release level and preserve provider-attempt history with a fresh PayChangu `charge_id` for each retry attempt. Advanced concurrent retry deduplication remains Phase 2 hardening. |
| **Resolved for launch scope** | Define the money formula before launch. | The formula is now implemented in code; keep the formula frozen and keep `signed/manual adjustment approval workflows` deferred until Phase 2 hardening. |
| **Open workflow decision** | Plan for payout failure after escrow release. | Add a seller/admin remediation state where destination details can be corrected and payout can be retried with a new provider attempt while preserving audit history. Do not silently reopen buyer escrow after provider failure. |
| **Open operations decision** | Plan for provider reversals/chargebacks. | Choose an operational policy for reversals after payout, such as reserve balance, negative seller balance, seller account hold, manual recovery, or some combination. |
| **Open security requirement** | Keep payout details private and encrypted. | Store seller payout destinations outside public seller profile data, encrypt full account/mobile values at rest, and expose only masked values through seller/admin APIs that need them. |
| **Open provider validation** | Confirm PayChangu balance settlement timing. | Verify whether checkout collections become payout-eligible automatically, after a delay, or only after a PayChangu-side/internal transfer from collection balance to main balance. |
| **Open data-model validation** | Decide whether orders can span multiple sellers. | If checkout can include multiple sellers, split checkout into seller-specific orders/escrows/payout candidates before enabling payouts. If the one-seller-per-order model is permanent, enforce it at checkout and document the invariant. |
| **Open platform requirement** | Add audit and notifications. | Add an audit trail for every payout status/provider-attempt transition, plus seller UI/email/in-app messages for setup required, payout queued, payout sent, payout paid, and payout failed. |

## Launch verification mode

Launch verification mode is **manual admin verification only**. BuyMesho should not treat PayChangu metadata lookup as account ownership validation at launch, because the current provider integration lists supported operators/banks and executes payouts but does not provide a reliable, documented pre-payout account-name verification response for every destination type. PayChangu-backed validation can be added later where a stable provider endpoint is confirmed and tested.

Manual verification SOP for launch:

1. Seller submits or replaces a payout destination from the seller payout settings UI. New and edited destinations start as `pending`, with `verification_attempts = 0`, `last_error = NULL`, and `verified_at = NULL`.
2. Admin reviews the masked destination, account holder name, provider/bank/mobile-money operator, seller identity/KYC evidence, and any out-of-band confirmation required by operations. Admins must not ask sellers to send full bank/mobile values through chat or other plaintext support channels.
3. Admin records the review through `POST /api/admin/payouts/destinations/:destinationId/verification` with one of these statuses:
   - `verified`: the destination can receive payouts. The route increments `verification_attempts`, clears `last_error`, sets `verified_at`, keeps the destination active, and writes a `seller_payout_account_events` audit row.
   - `failed`: the destination remains active for correction/replacement, but it must block payout submission. The route increments `verification_attempts`, stores the reason in `last_error`, clears `verified_at`, and writes an audit row.
   - `pending`: the destination stays under review. The route increments `verification_attempts`, clears `last_error` and `verified_at`, keeps the destination active, and writes an audit row.
   - `disabled`: the destination cannot be used. The route increments `verification_attempts`, stores the reason in `last_error`, clears `verified_at`, marks the destination inactive, and writes an audit row.
4. Payout execution must continue to require `verification_status = 'verified'` and `is_active = 1` before sending money to PayChangu. Failed, pending, disabled, missing, or inactive destinations must remain visible as remediation states rather than silently retrying provider submission.
5. Every manual review reason should be concise, operationally useful, and safe to show in admin/audit contexts. If a seller-facing explanation is needed, send a separate sanitized support message that does not expose sensitive payout details.

## How the seller should receive money

There are two viable PayChangu-supported settlement models.

### Option A — Platform escrow account, then PayChangu payout API

This matches the current BuyMesho architecture.

- Buyer pays into the BuyMesho PayChangu merchant account.
- The app treats the money as held in BuyMesho escrow while the order is active.
- After buyer release/admin resolution, BuyMesho creates a payout from the PayChangu available/main balance to the seller's registered destination.
- The seller receives the money in a mobile money wallet or bank account.

[PayChangu supports transfers/payouts](https://developer.paychangu.com/docs/introduction-2) from the merchant available balance to bank accounts and mobile money wallets. Payout initiation generally needs amount, currency, bank/mobile-money identifier, account/mobile number, recipient account name, and a unique `charge_id`, with specific endpoint details for [mobile money payouts](https://developer.paychangu.com/reference/mobile-money-payout) and [bank account payouts](https://developer.paychangu.com/docs/bank-account). [PayChangu's wallet balance documentation](https://developer.paychangu.com/docs/balance) distinguishes collection balance from main balance; payouts can be made from the main balance, so BuyMesho should verify operationally whether collected checkout funds are available for payout immediately, after settlement, or after internal transfer by PayChangu.

Recommended for the current codebase: **Option A first**, because the order/escrow data model already assumes BuyMesho controls release timing.

### Option B — PayChangu Connect / seller-owned PayChangu accounts

PayChangu Connect lets sellers connect their own PayChangu accounts and receive funds in their PayChangu wallet, while BuyMesho can add commission. This reduces BuyMesho's direct handling of seller funds, but it changes onboarding: each seller must have/connect a PayChangu account and BuyMesho must store a Connect token.

This is probably a later upgrade unless the marketplace wants to avoid holding funds directly from the beginning.

## Backend work to implement for Option A

### 1. Seller payout destination storage

Add a `seller_payout_accounts` table, separate from the public `sellers` profile table, because payout details are sensitive and operationally different from profile data.

Suggested fields:

- `id` (UUID string; stored as text, generated server-side)
- `seller_uid`
- `destination_type`: `mobile_money` or `bank`
- `currency`: initially `MWK`
- `provider_name`: Airtel Money, TNM Mpamba, National Bank, etc.
- `provider_ref_id`: PayChangu operator/bank identifier (when provider payload uses `uuid`, map that value into `provider_ref_id`)
- `account_name`
- `account_number_encrypted` or `mobile_encrypted`
- `masked_account`: for UI display only
- `is_default`
- `verification_status`: `pending`, `verified`, `failed`, `disabled`
- timestamps

Do not store full mobile/bank details in plaintext if this will be used in production.

#### Production operations: payout destination encryption

`SELLER_PAYOUT_ENCRYPTION_KEY` protects full seller bank account and mobile money values stored in `seller_payout_accounts`. Production deployments must treat this as a required secret:

- Set `SELLER_PAYOUT_ENCRYPTION_KEY` in every production environment before enabling payout destination create, update, replacement, retry, or provider-submission flows.
- Generate it as a high-entropy secret, such as a randomly generated 32-byte-or-longer value from the deployment secret tooling; do not use a human-readable password or a value derived from application metadata.
- Store and inject it only through the deployment secret manager used for production runtime configuration.
- Never commit the value, sample production values, or rotation exports to the repository, logs, tickets, screenshots, or documentation.

Current encryption format:

- `server/routes/escrow/payoutRoutes.ts` encrypts seller payout destination account/mobile values before storage with `aes-256-gcm`.
- The AES-256 key is derived at runtime with `scryptSync(SELLER_PAYOUT_ENCRYPTION_KEY, 'BuyMesho seller payout', 32)`.
- Each encryption uses a fresh 12-byte random IV.
- Stored ciphertext is a colon-delimited string of base64 values: `<iv>:<auth_tag>:<ciphertext>`.
- There is currently no key id, algorithm id, or version prefix in the stored value.
- `server/routes/escrow/payoutRoutes.ts` decrypts stored values for masked display, duplicate checks, updates, and replacements; `server/modules/payouts/payout.service.ts` decrypts them when building provider payout requests.

Key rotation plan before changing the production key:

1. Add key versioning first. New encrypted values should include a version/key id, and decrypt code should select the correct secret by that version while keeping compatibility with the current unversioned `<iv>:<auth_tag>:<ciphertext>` format.
2. Configure both the old and new keys in the secret manager during the rotation window, with the old key allowed only for decrypting existing values.
3. Run a controlled migration that decrypts each existing payout destination with the old key and immediately re-encrypts it with the new key/version.
4. Audit the rotation by recording counts for scanned, rotated, skipped, failed, and already-current rows; investigate and resolve every failure before retiring the old key.
5. After audit completion, remove the old key from production secrets and verify payout destination reads, updates, replacements, retries, and provider submissions still work with only the new key.

Malformed and legacy plaintext handling:

- `decryptSensitiveValue` currently treats any non-empty stored value that does not split into exactly three colon-delimited parts as legacy plaintext and returns it unchanged.
- This fallback keeps older or manually seeded rows readable, but production operations should treat any such row as sensitive plaintext debt: do not log the raw value, do not expose it through APIs, and re-save or migrate it into the encrypted format as soon as it is detected.
- Values that look like the expected three-part encrypted format but fail authentication/decryption return `null`; operators should handle these as malformed encrypted records that require investigation or seller destination re-entry, not as plaintext.
- Before launch, add an audit or migration report for plaintext-format rows so the team can confirm no active payout destination remains stored outside the encrypted format.

### 2. PayChangu payout provider module

Add a server-only PayChangu payout client that can:

- list supported banks/mobile money operators,
- check wallet balance before payout,
- initialize mobile money payouts,
- initialize bank payouts,
- fetch payout/transfer status,
- parse and verify payout webhooks if PayChangu sends payout status events.

BuyMesho's server-side PayChangu integration should generate a unique idempotent `charge_id` per provider attempt, not per payout row. Keep payout-level idempotency inside BuyMesho (one payout per escrow release), and create a new provider attempt identity for each retry (for example `BM-PO-{payoutId}-A{attemptNo}` or a dedicated `payout_attempt_id`).

### 3. Real payout lifecycle table

Expand the local `payouts` table beyond the current minimal columns.

Suggested statuses:

- `eligible`: escrow released, ready to pay
- `queued`: payout requested by seller/admin or auto-release job
- `processing`: request sent to PayChangu
- `pending`: PayChangu accepted request but final transfer is not complete
- `paid`: PayChangu confirms completion
- `failed`: PayChangu rejected/failed transfer
- `cancelled`: payout stopped before sending

Suggested additional fields:

- `destination_account_id`
- `provider`
- `current_provider_attempt_id` or `last_provider_attempt_id`
- `provider_ref_id`
- `provider_transaction_id`
- `provider_status`
- `failure_reason`
- `requested_by`
- `approved_by`
- `requested_at`, `sent_at`, `paid_at`, `failed_at`
- `raw_response`

To support retries cleanly, track provider attempts in a `payout_attempts` table or equivalent attempt history. Each attempt, not the payout candidate, should store its own `provider_charge_id`, request payload, response, status, and timestamps.

### 4. Release escrow should create a payable payout, not just flip state

When escrow is released:

1. Lock or transactionally load order + escrow + seller payout destination.
2. Validate order belongs to the seller and escrow is funded/held/disputed-resolved.
3. Compute seller net amount: order total minus BuyMesho commission/payment fees/refunds/adjustments.
4. Mark escrow `released` and append a ledger `release` entry.
5. Create a payout row with `queued` or `eligible` status.
6. Either auto-submit it to PayChangu or require admin approval/manual seller withdrawal.

Important: use idempotency so repeated release clicks/webhook retries do not create duplicate payout candidates, while payout retries to PayChangu always use a new provider attempt `charge_id`.

### 5. Payout reconciliation

Implement at least one of:

- payout status webhooks from PayChangu,
- scheduled polling of PayChangu transfer status,
- manual admin reconciliation screen.

On confirmed success, mark payout `paid`. On failure, keep escrow/order visible as released but payout failed, and let admins retry to a corrected payout destination.

### 6. Admin controls

Admins need tools to:

- view all released escrows waiting for payout,
- approve or retry payouts,
- see PayChangu provider references and errors,
- manually mark a payout paid only with an audit note,
- suspend payouts for a seller with suspicious/disputed orders.

## Seller UI work

### 1. Payout setup/onboarding

Add a seller payout setup screen/modal under seller settings or My Listings:

- Choose payout method: mobile money or bank.
- For mobile money: choose operator, enter mobile number, account holder name.
- For bank: choose bank, enter account number and account name.
- Show masked destination after saving.
- Show verification status and last updated date.

Implementation file plan:

- **Update `src/SellerPayoutsPage.tsx`** to keep the current full-page seller payout destination flow as the canonical launch surface, including destination form state, masked saved destinations, verification state badges, and payout history loading.
- **Update `src/SettingsPage.tsx`** to add a seller-only payout settings card/deep link so onboarding can be reached from account settings without duplicating sensitive payout forms in the settings page.
- **Update `src/MyListingsPage.tsx`** to add a seller dashboard CTA for missing/unverified payout destinations, because sellers already use My Listings as their operating dashboard.
- **Update `src/lib/appNavigation.ts` and `src/RootRouter.tsx`** only if route labels, redirects, or guard behavior need adjustment; the `/seller/payouts` route should remain the single destination for payout setup.
- **Create `src/modules/payouts/types.ts`** for shared seller-facing destination, payout, permission, and summary types now embedded in `SellerPayoutsPage.tsx`.
- **Create `src/modules/payouts/api.ts`** to centralize `apiFetch` calls for destination CRUD, payout history, provider/bank/operator metadata, permissions, and future withdrawal actions.
- **Create `src/components/payouts/PayoutDestinationForm.tsx`** for the mobile-money/bank form, validation messages, and save button state.
- **Create `src/components/payouts/PayoutDestinationCard.tsx`** for masked destination display, default/active labels, verification status, last updated date, and safe replace/remove actions.
- **Create `src/components/payouts/PayoutStatusBadge.tsx`** for consistent seller/admin payout and destination status language.
- **Create `src/components/payouts/__tests__/PayoutDestinationForm.test.tsx`** to cover method-specific required fields, masking-only display expectations, and disabled submit states.

### 2. Seller earnings dashboard

Extend the seller dashboard to include money states:

- lifetime sales,
- currently in escrow,
- available for payout,
- pending payout,
- paid out,
- failed payout requiring action.

Implementation file plan:

- **Update `src/MyListingsPage.tsx`** to add an earnings summary panel near the existing seller stock/listing metrics, using server-derived payout/escrow totals instead of recalculating financial truth in the browser.
- **Update `src/SellerPayoutsPage.tsx`** to reuse the same summary model for the payout page hero cards so the numbers match My Listings.
- **Update `src/types.ts`** if the existing seller dashboard response shape is extended with payout/escrow totals from the server.
- **Create `src/modules/payouts/summary.ts`** for formatting and grouping seller payout states into `lifetimeSales`, `inEscrow`, `availableForPayout`, `pendingPayout`, `paidOut`, and `failedActionRequired` buckets.
- **Create `src/components/payouts/SellerEarningsSummary.tsx`** as a reusable card grid for My Listings and Seller Payouts.
- **Create `src/components/payouts/PayoutActionRequiredBanner.tsx`** for failed payout or unverified destination warnings that need seller action.
- **Create `src/modules/payouts/__tests__/summary.test.ts`** to lock the state-to-money-bucket mapping, especially `eligible`/`queued`/`processing`/`pending`/`held`/`paid`/`failed` handling.

### 3. Order-level seller view

Sellers should see each paid order with:

- payment captured,
- escrow state,
- release eligibility,
- payout status,
- estimated payout date,
- payout destination mask.

Implementation file plan:

- **Update `src/TrackOrderPage.tsx` and/or `src/OrderTrackingPage.tsx`** after confirming which route is seller-facing for order detail access; buyer-only copy must not leak into the seller order view.
- **Update `src/components/orders/EscrowProtectionCard.tsx`** to show seller-facing payout status copy when the viewer is the seller, while keeping buyer protection copy for buyers.
- **Update `src/components/orders/OrderDetailsCard.tsx`** to include seller payout fields when present: payout status, estimated payout date, destination mask, and any release eligibility label.
- **Update `src/lib/orderApi.ts`** so the order detail fetch/normalizer carries seller payout metadata returned by the backend.
- **Update `src/shared/types/payment.ts` and/or `src/types.ts`** with the order-level payout metadata contract.
- **Create `src/components/orders/SellerOrderPayoutPanel.tsx`** for seller-only order payout state, release eligibility, destination mask, and failed/held guidance.
- **Create `src/modules/payouts/orderPayoutViewModel.ts`** to convert raw payout/escrow/order fields into seller-safe labels and estimated-date text.
- **Create `src/modules/payouts/__tests__/orderPayoutViewModel.test.ts`** to verify that seller order labels do not expose raw provider errors, full account details, or admin-only notes.

### 4. Withdraw or automatic payout UX

Choose one product policy:

- Automatic payout after escrow release: simplest for sellers, more backend responsibility.
- Seller-requested withdrawal: gives sellers control and lets you batch payouts, but adds a withdrawal request UI.
- Admin-approved payout: safest during beta, slower for sellers.

For launch, a practical approach is **admin-approved automatic queue**: release creates a queued payout, admins send it to PayChangu, and sellers can see status.

Implementation file plan for the launch policy:

- **Update `src/SellerPayoutsPage.tsx`** to make the seller UX status-first rather than withdrawal-first: sellers should see queued/admin-approved automatic payout status and clear guidance when no action is available.
- **Update `src/modules/payouts/uiModel.ts`** to include launch-policy labels such as `Queued for admin review`, `Sent to PayChangu`, `Provider pending`, `Paid`, `Held`, and `Needs destination update`.
- **Update `src/AdminPayoutsManager.tsx`, `src/AdminPayoutQueue.tsx`, and/or `src/AdminPaymentsConsole.tsx`** only for cross-link text and seller-visible status consistency; admin approval remains an admin surface, not a seller button.
- **Create `src/components/payouts/PayoutTimeline.tsx`** for seller-facing payout lifecycle events from queued through paid/failed.
- **Create `src/components/payouts/PayoutPolicyExplainer.tsx`** to explain the admin-approved automatic queue and set expectations about timing.
- **Defer creating a seller withdrawal request component** until the product policy changes from admin-approved automatic queue to seller-requested withdrawals.
- **Create `src/components/payouts/__tests__/PayoutPolicyExplainer.test.tsx`** to lock the launch copy so the UI does not imply sellers can manually withdraw during beta.

## Recommended launch sequence

1. Add payout destination collection for sellers.
2. Add payout tables/statuses and backend provider client.
3. Change escrow release to create exactly one payout candidate.
4. Build admin payout queue and manual retry.
5. Add seller earnings/payout status UI.
6. Add PayChangu payout webhooks or scheduled polling.
7. Later evaluate PayChangu Connect if BuyMesho wants seller-owned PayChangu wallets and automatic commission splitting.


## Production policy decisions (launch baseline)

The following policies convert the previously open workflow/operations questions into launch decisions. They are intended to be implemented as operational guardrails for the existing payout lifecycle (`eligible`/`queued`/`processing`/`pending`/`paid`/`failed`) without changing the escrow release invariant that buyer/admin release is final.

### 1) Provider reversals and chargebacks after payout

Policy objective: preserve platform solvency and auditability when funds are clawed back by the provider after the seller was already paid.

- **Reserve balance first:** Any provider reversal/chargeback is covered from the seller's accumulated reserve balance before affecting withdrawable amounts.
- **Seller negative balance next:** If reserve is insufficient, the remaining amount is posted as seller negative balance (ledger debt) and future eligible payouts are netted down automatically until the debt is cleared.
- **Automatic account hold threshold:** Seller payout account is put on `hold` for new payout submissions while negative balance remains outstanding (or while repeated reversals exceed risk thresholds), but historical payouts and order records remain visible.
- **Manual recovery escalation:** Admin finance/risk team can execute manual recovery (off-platform collection, negotiated repayment plan, or support-mediated resolution) and record mandatory audit notes.
- **No escrow rewind:** Reversal events do not reopen completed buyer escrow release; they create separate post-release financial adjustment entries.

Implementation follow-ups (if not already present in code):

1. Add seller-balance ledger support for `reversal_debit`, `negative_balance_carry`, and `manual_recovery_credit` event types.
2. Add seller payout hold flags/reasons and enforce hold checks before payout attempt creation.
3. Add admin tooling to clear/reapply hold and capture recovery notes with immutable audit trail.

### 2) PayChangu balance settlement assumptions

Policy objective: avoid submitting payouts that PayChangu cannot settle from `main_balance`.

- **Collection-to-main transition assumption:** Checkout captures may appear in `collection_balance` first and become payout-eligible only after they are reflected in `main_balance` (per PayChangu wallet behavior).
- **Submission gate:** BuyMesho must verify available `main_balance` at payout submission time; do not assume escrow release means provider funds are instantly transferable.
- **Wait behavior:** For auto-payout flows, queue and retry using backoff when `main_balance` is insufficient instead of immediate failure, unless a max-attempt window is exceeded.
- **Insufficient main balance handling:** Mark payout as `queued`/`pending_funding` (or equivalent internal reason attached to `queued`) and avoid consuming a terminal `failed` state until funding checks or provider response confirm real failure.

Implementation follow-ups (if not already present in code):

1. Add pre-submit provider balance check (`wallet-balance`) in payout dispatcher.
2. Persist funding-gate reason/metadata on payout attempts (for example `insufficient_main_balance`).
3. Add scheduler logic for delayed resubmission once main balance is adequate.

### 3) Correction workflow after destination failure

Policy objective: allow safe retry after destination errors while preserving immutable history.

- **Seller replaces destination:** Seller can submit a new payout destination when failure reason indicates invalid/closed account, wrong operator/bank mapping, or other destination-level error.
- **Admin verifies destination:** New destination remains non-runnable until admin verification (or configured automated verification) marks it `verified`.
- **Admin retries payout:** Retry creates a new provider attempt with a fresh `charge_id` bound to the replacement destination; original failed attempt remains untouched.
- **Immutable attempt history:** Previous attempts, payload snapshots, provider responses, timestamps, and failure reasons are append-only and never overwritten.

Implementation follow-ups (if not already present in code):

1. Enforce append-only `payout_attempts` history and prohibit in-place mutation of historical attempt payload/response fields.
2. Add destination-version linkage on each attempt so retries clearly show which destination record/version was used.
3. Require verification-state check (`verified`) before admin retry endpoint can submit provider attempt.

### 4) Cross-policy linkage to launch implementation tasks

To keep these decisions actionable, tie them to concrete backlog items before payout go-live:

- **Reversal/chargeback controls:** extend payout/ledger schema and admin controls in the backend payout module.
- **Funding-gate controls:** preserve PayChangu `main_balance` checks in the payout dispatcher and add queued retry orchestration for funding-related holds in reconciliation jobs.
- **Destination correction controls:** preserve destination replacement + verification + admin retry flow with immutable attempt history, and complete any remaining seller/admin remediation UI hardening.
- **Audit/observability:** preserve existing payout audit events and add any missing operator-visible status labels for `negative_balance`, `pending_funding`, and `recovery_in_progress` transitions.

These follow-ups should be tracked as remaining hardening items around payout provider submission, reconciliation jobs, and seller/admin payout management endpoints; they do not mean release-time PayChangu dispatch is absent.





//#######Get Banks

# Get Banks

Query for all Banks

This endpoint enables you to retrieve all the banks we currently support in processing payments.

# OpenAPI definition

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "live",
    "version": "1.0"
  },
  "servers": [
    {
      "url": "https://api.paychangu.com"
    }
  ],
  "components": {
    "securitySchemes": {
      "sec0": {
        "type": "apiKey",
        "in": "header",
        "name": "Authorization",
        "x-default": "",
        "x-bearer-format": "bearer"
      }
    }
  },
  "security": [
    {
      "sec0": []
    }
  ],
  "paths": {
    "/direct-charge/payouts/supported-banks?currency=MWK": {
      "get": {
        "summary": "Get Banks",
        "description": "Query for all Banks",
        "operationId": "get-banks",
        "responses": {
          "200": {
            "description": "200",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": {
                      "status": "success",
                      "message": "Retrieved successfully.",
                      "data": [
                        {
                          "uuid": "82310dd1-ec9b-4fe7-a32c-2f262ef08681",
                          "name": "National Bank of Malawi"
                        },
                        {
                          "uuid": "87e62436-0553-4fb5-a76d-f27d28420c5b",
                          "name": "Ecobank Malawi Limited"
                        },
                        {
                          "uuid": "b064172a-8a1b-4f7f-aad7-81b036c46c57",
                          "name": "FDH Bank Limited"
                        },
                        {
                          "uuid": "e7447c2c-c147-4907-b194-e087fe8d8585",
                          "name": "Standard Bank Limited"
                        },
                        {
                          "uuid": "236760c9-3045-4a01-990e-497b28d115bb",
                          "name": "Centenary Bank"
                        },
                        {
                          "uuid": "968ac588-3b1f-4d89-81ff-a3d43a599003",
                          "name": "First Capital Limited"
                        },
                        {
                          "uuid": "c759d7b6-ae5c-4a95-814a-79171271897a",
                          "name": "CDH Investment Bank"
                        },
                        {
                          "uuid": "5e9946ae-76ed-43f5-ad59-63e09096006a",
                          "name": "TNM Mpamba"
                        },
                        {
                          "uuid": "e8d5fca0-e5ac-4714-a518-484be9011326",
                          "name": "Airtel Money"
                        },
                        {
                          "uuid": "86007bf5-1b04-49ba-84c1-9758bbf5c996",
                          "name": "NBS Bank Limited"
                        }
                      ]
                    }
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "example": "success"
                    },
                    "message": {
                      "type": "string",
                      "example": "Retrieved successfully."
                    },
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "uuid": {
                            "type": "string",
                            "example": "82310dd1-ec9b-4fe7-a32c-2f262ef08681"
                          },
                          "name": {
                            "type": "string",
                            "example": "National Bank of Malawi"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "description": "400",
            "content": {
              "application/json": {
                "examples": {
                  "Result": {
                    "value": "{}"
                  }
                },
                "schema": {
                  "type": "object",
                  "properties": {}
                }
              }
            }
          }
        },
        "deprecated": false,
        "security": [
          {
            "sec0": []
          }
        ]
      }
    }
  },
  "x-readme": {
    "headers": [],
    "explorer-enabled": true,
    "proxy-enabled": true
  },
  "x-readme-fauxas": true
}
```

