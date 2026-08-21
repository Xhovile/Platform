import type { OtpChallenge } from "./contracts.js";

/**
 * Application-owned persistence boundary for OTP challenges.
 *
 * Implementations may use any durable store. Platform does not assume a
 * database, ORM, document model, or vendor-specific SDK.
 */
export interface OtpChallengeRepository {
  /** Persist a newly issued challenge. */
  create(challenge: OtpChallenge): Promise<void>;

  /** Return a challenge by id, or null when it does not exist. */
  get(id: string): Promise<OtpChallenge | null>;

  /** Replace the persisted representation of an existing challenge. */
  update(challenge: OtpChallenge): Promise<void>;

  /** Remove a challenge. Missing challenges should be treated as a no-op. */
  delete(id: string): Promise<void>;
}
