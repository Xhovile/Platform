import assert from "node:assert/strict";
import { test } from "node:test";
import { issueOtp, verifyOtp } from "../src/index.js";

const NOW = new Date("2026-08-21T00:00:00.000Z");

function issue() {
  return issueOtp(
    "+265888000000",
    "whatsapp",
    {
      codeLength: 6,
      ttlMs: 5 * 60 * 1000,
      maxAttempts: 3,
    },
    NOW
  );
}

test("issues a six-digit OTP without storing the plaintext code", () => {
  const result = issue();

  assert.match(result.code, /^\d{6}$/);
  assert.notEqual(result.challenge.codeHash, result.code);
  assert.equal(result.challenge.attempts, 0);
  assert.equal(result.challenge.consumed, false);
  assert.equal(result.challenge.expiresAt, "2026-08-21T00:05:00.000Z");
});

test("verifies the issued OTP and consumes the challenge", () => {
  const result = issue();
  const verified = verifyOtp(result.challenge, result.code, NOW);

  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.challenge.consumed, true);
  }

  const replay = verifyOtp(verified.challenge, result.code, NOW);
  assert.equal(replay.ok, false);
  if (!replay.ok) {
    assert.equal(replay.reason, "consumed");
  }
});

test("increments failed attempts and locks after the configured maximum", () => {
  const result = issue();

  const first = verifyOtp(result.challenge, "000000", NOW);
  assert.equal(first.ok, false);
  if (!first.ok) {
    assert.equal(first.reason, "invalid-code");
    assert.equal(first.challenge.attempts, 1);
  }

  const second = verifyOtp(first.challenge, "000000", NOW);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, "invalid-code");
    assert.equal(second.challenge.attempts, 2);
  }

  const third = verifyOtp(second.challenge, "000000", NOW);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.reason, "max-attempts");
    assert.equal(third.challenge.attempts, 3);
  }

  const blocked = verifyOtp(third.challenge, result.code, NOW);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.reason, "max-attempts");
  }
});

test("rejects an expired challenge", () => {
  const result = issue();
  const expired = verifyOtp(
    result.challenge,
    result.code,
    new Date("2026-08-21T00:05:00.000Z")
  );

  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.reason, "expired");
  }
});
