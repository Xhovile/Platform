import assert from "node:assert/strict";
import test from "node:test";
import {
  WhatsAppDeliveryError,
  WhatsAppOtpProvider,
} from "../../src/providers/whatsapp.js";
import type { OtpDeliveryRequest } from "../../src/index.js";

const request: OtpDeliveryRequest = {
  challengeId: "challenge-123",
  subject: "+265888000000",
  channel: "whatsapp",
  code: "482913",
  expiresAt: "2026-08-21T00:05:00.000Z",
};

test("sends an OTP as a WhatsApp text message", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = new WhatsAppOtpProvider({
    accessToken: "token-123",
    phoneNumberId: "phone-123",
    apiVersion: "v25.0",
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          messages: [{ id: "wamid.123" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    buildTextMessage: (code) => `Use ${code} to sign in.`,
  });

  const result = await provider.deliver(request);

  assert.equal(result.providerMessageId, "wamid.123");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://graph.facebook.com/v25.0/phone-123/messages",
  );
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(
    calls[0].init?.headers && typeof calls[0].init.headers === "object"
      ? (calls[0].init.headers as Record<string, string>).Authorization
      : undefined,
    "Bearer token-123",
  );

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "+265888000000",
    type: "text",
    text: {
      preview_url: false,
      body: "Use 482913 to sign in.",
    },
  });
});

test("supports application-configured WhatsApp templates", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new WhatsAppOtpProvider({
    accessToken: "token-123",
    phoneNumberId: "phone-123",
    messageMode: "template",
    template: {
      name: "authentication_code_copy_code_button",
      languageCode: "en_US",
      buildComponents: (code) => [
        {
          type: "body",
          parameters: [{ type: "text", text: code }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: `otp${code}` }],
        },
      ],
    },
    fetch: async (_url, init = {}) => {
      requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ messages: [{ id: "wamid.template" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await provider.deliver(request);
  assert.equal(result.providerMessageId, "wamid.template");
  assert.deepEqual(requestBody?.template, {
    name: "authentication_code_copy_code_button",
    language: { code: "en_US" },
    components: [
      {
        type: "body",
        parameters: [{ type: "text", text: "482913" }],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "otp482913" }],
      },
    ],
  });
});

test("surfaces Meta errors without exposing the access token", async () => {
  const provider = new WhatsAppOtpProvider({
    accessToken: "super-secret-token",
    phoneNumberId: "phone-123",
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid OAuth access token.",
            code: 190,
            error_subcode: 123,
            fbtrace_id: "trace-123",
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
  });

  await assert.rejects(
    provider.deliver(request),
    (error: unknown) => {
      assert.ok(error instanceof WhatsAppDeliveryError);
      assert.equal(error.status, 401);
      assert.equal(error.metaCode, 190);
      assert.equal(error.metaSubcode, 123);
      assert.equal(error.traceId, "trace-123");
      assert.doesNotMatch(error.message, /super-secret-token/);
      return true;
    },
  );
});

test("rejects non-WhatsApp delivery requests", async () => {
  const provider = new WhatsAppOtpProvider({
    accessToken: "token-123",
    phoneNumberId: "phone-123",
    fetch: async () => new Response("{}", { status: 200 }),
  });

  await assert.rejects(
    provider.deliver({ ...request, channel: "sms" }),
    /cannot deliver channel: sms/,
  );
});
