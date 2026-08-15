# Passkey Architecture

## Boundary

`auth/passkeys` provides protocol-level WebAuthn operations. It does not own product routes, UI, Firebase configuration, authorization roles, or business-domain rules.

## Layers

1. **Core** — WebAuthn option generation and response verification.
2. **Credential repository interface** — persistence abstraction for passkey credentials.
3. **Challenge/state repository interface** — persistence abstraction for short-lived ceremonies.
4. **Application adapter** — maps an application's user identity and request context into the core contracts.
5. **Product integration** — BuyMesho owns its routes, screens, Firebase user identity, and account settings.

## Initial BuyMesho strategy

Do not move or replace existing authentication code yet. First introduce passkey support alongside the existing authentication flow:

`Existing authenticated BuyMesho account -> register passkey -> credential linked to Firebase UID -> authenticate with passkey -> existing BuyMesho session`

This allows passkeys to be introduced without disrupting existing passwords, email verification, or account recovery.

## Future extraction

After the first passkey implementation is proven in BuyMesho, reusable session, 2FA, payment, messaging, and notification components can be extracted incrementally into Platform using the same boundary-first approach.
