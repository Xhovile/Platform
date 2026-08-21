# OTP

Reusable one-time-password infrastructure for Xhovile applications.

## Responsibilities

Platform OTP owns:

- cryptographically secure OTP generation
- OTP code hashing
- challenge expiry and attempt semantics
- single-use verification semantics
- application-owned persistence contracts
- delivery-provider contracts
- integration with the shared Platform rate limiter
- concrete WhatsApp delivery through the provider package

The consuming application owns:

- user/account identity mapping
- challenge persistence implementation
- OTP rate-limit policy and abuse controls
- session creation and authentication state
- delivery credentials and provider configuration
- message/template policy
- application routes, UI, and business rules

## Public package

```ts
import {
  issueOtp,
  verifyOtp,
  WhatsAppOtpProvider,
  checkOtpRateLimit,
} from "@xhovile/platform/otp";
```

## Typical flow

```text
Application request
      ↓
Application-owned rate-limit policy
      ↓
Platform issueOtp()
      ↓
Application persists challenge
      ↓
Platform delivery provider
      ↓
User receives OTP
      ↓
Application loads challenge
      ↓
Platform verifyOtp()
      ↓
Application resolves identity
      ↓
Application creates/updates session
```

## Security notes

The plaintext OTP is returned only by issuance so the application can deliver it through the selected provider. Persist only the challenge returned by Platform; the challenge contains the salted OTP hash rather than the plaintext code.

Applications should configure rate limits appropriate to their threat model. Platform does not impose BuyMesho-specific limits.

WhatsApp access tokens and phone-number identifiers must remain application-controlled secrets. Do not expose them to browser code or logs.
