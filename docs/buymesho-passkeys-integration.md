# BuyMesho Passkey Integration

## Goal

Add passkey authentication to BuyMesho without replacing its existing Firebase Authentication and session model in the first release.

## Runtime flow

### Enrollment

1. User is already authenticated in BuyMesho.
2. BuyMesho calls the Platform `createRegistrationOptions` API with the current Firebase UID, account name, and existing credentials.
3. Platform creates a short-lived registration ceremony and returns `ceremonyId` plus WebAuthn options.
4. Browser calls `registerPasskey(options)`.
5. BuyMesho posts the returned credential plus `ceremonyId` to its server.
6. Platform verifies origin, RP ID, challenge, signature, and user verification.
7. BuyMesho stores the returned credential through `PasskeyCredentialRepository`.

### Passwordless login

1. Login page calls Platform `createDiscoverableAuthenticationOptions`.
2. Browser calls `authenticateWithPasskey(options)`.
3. BuyMesho posts the response plus `ceremonyId` to its server.
4. Platform finds the credential by credential ID, verifies the signature and challenge, updates the counter, and returns the linked BuyMesho UID.
5. BuyMesho exchanges that verified UID for its normal authenticated session. The Platform layer does not own Firebase sessions.

## Recommended credential storage

Use BuyMesho's existing PostgreSQL infrastructure for a dedicated passkey credential table. Store the WebAuthn credential ID, public key bytes, counter, transports, Firebase UID, device type, backup state, display name, timestamps, and revocation state.

Do not store private keys, authenticator secrets, or raw biometric data.

## Recommended ceremony storage

Ceremonies must be short-lived and single-use. PostgreSQL is suitable for the first implementation. A Redis-backed adapter can be introduced later if the deployment needs higher-throughput ephemeral state.

## Firebase session boundary

For passwordless login, the expected pattern is:

`Passkey verified -> Firebase UID -> Firebase custom token -> signInWithCustomToken() -> existing BuyMesho session`

The exact session exchange should remain BuyMesho-specific because Platform must stay reusable by other Xhovile applications.

## Relying-party configuration

Production should use the actual BuyMesho domain as the WebAuthn RP ID and expected origin. Local development can use localhost.

The RP ID and origin must be treated as deployment configuration, not hard-coded inside the shared Platform package.

## First integration scope

Do not remove password login or the existing TOTP flow in the first release. Add passkeys alongside them, verify the complete enrollment and login lifecycle, and only then decide whether passkeys should become the preferred login path for some users or roles.
