import assert from "node:assert/strict";
import test from "node:test";
import type { OtpChallenge } from "../src/contracts.js";
import type { OtpChallengeRepository } from "../src/repository.js";

class MemoryOtpChallengeRepository implements OtpChallengeRepository {
  private readonly challenges = new Map<string, OtpChallenge>();

  async create(challenge: OtpChallenge): Promise<void> {
    if (this.challenges.has(challenge.id)) {
      throw new Error(`OTP challenge already exists: ${challenge.id}`);
    }
    this.challenges.set(challenge.id, structuredClone(challenge));
  }

  async get(id: string): Promise<OtpChallenge | null> {
    const challenge = this.challenges.get(id);
    return challenge ? structuredClone(challenge) : null;
  }

  async update(challenge: OtpChallenge): Promise<void> {
    if (!this.challenges.has(challenge.id)) {
      throw new Error(`OTP challenge does not exist: ${challenge.id}`);
    }
    this.challenges.set(challenge.id, structuredClone(challenge));
  }

  async delete(id: string): Promise<void> {
    this.challenges.delete(id);
  }
}

function challenge(): OtpChallenge {
  return {
    id: "challenge-1",
    subject: "+265888000000",
    channel: "whatsapp",
    codeHash: "hash",
    salt: "salt",
    createdAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-21T00:05:00.000Z",
    attempts: 0,
    maxAttempts: 5,
    consumed: false,
  };
}

test("repository persists and returns an isolated challenge", async () => {
  const repository = new MemoryOtpChallengeRepository();
  const original = challenge();

  await repository.create(original);
  const stored = await repository.get(original.id);

  assert.deepEqual(stored, original);
  assert.notStrictEqual(stored, original);
});

test("repository updates an existing challenge", async () => {
  const repository = new MemoryOtpChallengeRepository();
  const original = challenge();

  await repository.create(original);

  const updated = {
    ...original,
    attempts: 1,
  };
  await repository.update(updated);

  assert.deepEqual(await repository.get(original.id), updated);
});

test("repository rejects updating a missing challenge", async () => {
  const repository = new MemoryOtpChallengeRepository();

  await assert.rejects(repository.update(challenge()), /does not exist/);
});

test("repository deletes a challenge and returns null afterwards", async () => {
  const repository = new MemoryOtpChallengeRepository();
  const original = challenge();

  await repository.create(original);
  await repository.delete(original.id);

  assert.equal(await repository.get(original.id), null);
});

test("repository treats deleting a missing challenge as a no-op", async () => {
  const repository = new MemoryOtpChallengeRepository();

  await assert.doesNotReject(repository.delete("missing"));
});
