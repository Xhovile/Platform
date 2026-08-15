# Passkeys

WebAuthn/passkey authentication capability for Xhovile applications.

## Design goals

- Keep WebAuthn ceremony and verification logic isolated from product UI.
- Support registration and authentication ceremonies.
- Store only credential metadata and public-key material on the server; private key material remains with the user's authenticator.
- Make application integration explicit through adapters/interfaces.
- Support multiple credentials per account and credential revocation.
- Include origin/RP-ID configuration, challenge handling, verification, replay protection, and auditability.

## Planned public operations

- createRegistrationOptions
- verifyRegistrationResponse
- createAuthenticationOptions
- verifyAuthenticationResponse
- listCredentials
- revokeCredential

## BuyMesho integration

BuyMesho is the first consumer. Its existing Firebase Authentication and server authentication/session layers remain the source of truth during the first integration. Platform passkeys will be linked to the existing user identity rather than replacing BuyMesho authentication in one step.

## Security requirements

- Secure HTTPS deployment outside localhost development.
- Exact RP ID and allowed origin configuration per application environment.
- Server-generated, single-use challenges with expiry.
- Verification of challenge, origin, RP ID, signature, user presence, and user verification according to the selected WebAuthn policy.
- No private keys or raw authenticator secrets stored by the application.
- Credential ownership bound to the authenticated application account.
- Audit events for registration, authentication, and revocation.
