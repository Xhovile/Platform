# Passkeys

WebAuthn/passkey authentication capability for Xhovile applications.

## Design goals

- Keep WebAuthn ceremony and verification logic isolated from product UI.
- Support both account-linked authentication and discoverable/passwordless authentication.
- Store credential metadata and public-key material on the server; private key material remains with the user's authenticator.
- Make application integration explicit through adapters/interfaces.
- Support multiple credentials per account, credential revocation, counters, device type, and backup state.
- Require explicit relying-party ID and origin configuration.
- Keep challenges server-generated, short-lived, and single-use.

## Public operations

- `createRegistrationOptions`
- `verifyRegistration`
- `createAuthenticationOptions` for a known account
- `createDiscoverableAuthenticationOptions` for passwordless login
- `verifyAuthentication`
- browser helpers: `registerPasskey`, `authenticateWithPasskey`, `isPasskeySupported`

## BuyMesho integration

BuyMesho is the first consumer. Its existing Firebase Authentication and server authentication/session layers remain the source of truth during the first integration. Platform passkeys are linked to the existing BuyMesho user identity rather than creating a second account system.

The application supplies two adapters:

1. `PasskeyCredentialRepository` for storing credentials and updating counters/revocation state.
2. `PasskeyCeremonyRepository` for storing and consuming short-lived registration/authentication challenges.

The application also decides how a verified Platform result becomes an application session. Platform does not create BuyMesho Firebase sessions itself.

## Security requirements

- Secure HTTPS deployment outside localhost development.
- Exact RP ID and allowed origin configuration per application environment.
- Server-generated, short-lived, single-use challenges.
- Verification of challenge, origin, RP ID, signature, and user verification according to the application's policy.
- `userVerification: 'required'` for Platform passkey verification in the current implementation.
- No private keys or raw authenticator secrets stored by the application.
- Credential ownership bound to the application account.
- Credential counters updated after successful authentication.
- Audit events for registration, authentication, and revocation should be emitted by the consuming application.

## Runtime

The server package targets modern Node.js runtimes. `@simplewebauthn/server` v13 documents Node LTS 20.x and higher.
