import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OTP_POLICY,
  WhatsAppOtpProvider,
  checkOtpRateLimit,
  issueOtp,
  verifyOtp,
} from "../src/index.js";

test("OTP public entry point exposes the supported package surface", () => {
  assert.equal(typeof issueOtp, "function");
  assert.equal(typeof verifyOtp, "function");
  assert.equal(typeof checkOtpRateLimit, "function");
  assert.equal(typeof WhatsAppOtpProvider, "function");
  assert.equal(DEFAULT_OTP_POLICY.codeLength, 6);
});
