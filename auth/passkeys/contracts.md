# Passkey Integration Contracts

The first implementation should expose framework-neutral contracts. BuyMesho-specific Firebase and Express/Vite details belong in an adapter layer in BuyMesho.

## Registration

Input:

- application/user identifier
- authenticated account context
- RP configuration
- optional authenticator preferences

Flow:

1. Generate a cryptographically secure challenge.
2. Persist challenge state with a short expiry and ceremony binding.
3. Return WebAuthn registration options to the client.
4. Receive the authenticator response.
5. Verify challenge, origin, RP ID, attestation policy, and response integrity.
6. Persist credential ID, public key, sign counter, transports, and metadata.
7. Mark the credential as active and emit an audit event.

## Authentication

Input:

- application/user discovery context
- RP configuration
- authentication policy

Flow:

1. Generate a single-use challenge.
2. Return WebAuthn authentication options.
3. Verify assertion against the stored credential.
4. Validate challenge, origin, RP ID, signature, and sign counter according to policy.
5. Return an authenticated platform identity result to the application adapter.
6. Application creates/updates its normal session.

## Credential management

A user can have multiple passkeys. The API must support listing and revoking individual credentials without deleting the application account.

## Non-goals

The core module does not create React components, Firebase users, application sessions, or marketplace authorization decisions.
