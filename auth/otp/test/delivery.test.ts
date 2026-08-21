import assert from "node:assert/strict";
import test from "node:test";
import type { OtpDeliveryProvider, OtpDeliveryRequest } from "../src/index.js";

class RecordingProvider implements OtpDeliveryProvider {
  requests: OtpDeliveryRequest[] = [];

  async deliver(request: OtpDeliveryRequest) {
    this.requests.push(request);
    return { providerMessageId: "provider-123" };
  }
}

test("delivery providers receive the OTP transport request", async () => {
  const provider = new RecordingProvider();

  const result = await provider.deliver({
    challengeId: "challenge-123",
    subject: "+265888000000",
    channel: "whatsapp",
    code: "482913",
    expiresAt: "2026-08-21T00:05:00.000Z",
  });

  assert.deepEqual(provider.requests[0], {
    challengeId: "challenge-123",
    subject: "+265888000000",
    channel: "whatsapp",
    code: "482913",
    expiresAt: "2026-08-21T00:05:00.000Z",
  });
  assert.equal(result.providerMessageId, "provider-123");
});
