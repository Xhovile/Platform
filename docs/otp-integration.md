# OTP integration guide

The OTP module is deliberately split across reusable mechanisms and application-owned policy.

## 1. Issue a challenge

```ts
const { code, challenge } = issueOtp(subject, channel, policy);
```

Persist the `challenge` through the application's implementation of `OtpChallengeRepository`.

Do not persist the plaintext `code` as part of the challenge record.

## 2. Apply application-owned rate limits

Use the shared `RateLimiter` with `checkOtpRateLimit()`:

```ts
const result = await checkOtpRateLimit(limiter, {
  operation: "issue",
  subject: phoneNumber,
  channel: "whatsapp",
  ip,
  userId,
});
```

The application supplies the `RateLimitPolicy`, including limits, windows, key strategy, and failure mode. Platform does not choose the product policy.

## 3. Deliver the code

Configure a delivery provider in the application. For WhatsApp:

```ts
const provider = new WhatsAppOtpProvider({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  messageMode: "template",
  template: {
    name: "your_approved_template",
    languageCode: "en_US",
  },
});
```

The application owns the credentials and template configuration.

## 4. Verify the challenge

Load the challenge from the application's repository and verify it through Platform:

```ts
const result = verifyOtp(challenge, submittedCode);
```

If verification succeeds, the application resolves the verified identity and decides whether to create or upgrade a session.

Platform OTP does not create Firebase sessions or application sessions.

## Boundary summary

| Concern | Owner |
| --- | --- |
| OTP generation and hashing | Platform |
| Challenge semantics | Platform |
| Challenge persistence | Application |
| Rate-limit policy | Application |
| Rate-limit mechanism | Platform |
| Delivery contract | Platform |
| WhatsApp transport | Platform provider |
| WhatsApp credentials/template policy | Application |
| Identity mapping | Application |
| Sessions | Application |
