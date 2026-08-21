# OTP delivery providers

`OtpDeliveryProvider` is the transport boundary for OTP delivery.

Platform owns OTP generation and verification. A consuming application chooses and configures the provider that actually sends the code.

Providers receive the challenge ID, destination subject, channel, plaintext code, and expiry timestamp. Providers must not persist or log the code unnecessarily.
