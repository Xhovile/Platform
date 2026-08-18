import { createHash, randomUUID } from "node:crypto";
import { postgresDb as db } from "../db.js";

export type IdempotencyBeginResult =
  | { kind: "started"; id: string }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "processing" };

export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("This Idempotency-Key was already used for a different request.");
    this.name = "IdempotencyKeyConflictError";
  }
}

let schemaReady = false;

function ensureSchema(): void {
  if (schemaReady) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_operations (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      user_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      response_status INTEGER,
      response_body TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_operations_key
    ON idempotency_operations (scope, user_id, idempotency_key);

    CREATE INDEX IF NOT EXISTS idx_idempotency_operations_status
    ON idempotency_operations (status, updated_at);
  `);

  schemaReady = true;
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function hashIdempotencyRequest(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(serialized ?? "").digest("hex");
}

function parseStoredBody(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function beginIdempotentOperation(input: {
  scope: string;
  key: string;
  userId: string;
  requestHash: string;
}): IdempotencyBeginResult {
  ensureSchema();

  const scope = normalize(input.scope);
  const key = normalize(input.key);
  const userId = normalize(input.userId);
  const requestHash = normalize(input.requestHash);

  if (!scope || !key || !userId || !requestHash) {
    throw new Error("scope, key, userId and requestHash are required for idempotency");
  }

  const existing = db
    .prepare(
      `SELECT id, request_hash, status, response_status, response_body
       FROM idempotency_operations
       WHERE scope = ? AND user_id = ? AND idempotency_key = ?
       LIMIT 1`,
    )
    .get(scope, userId, key) as
    | {
        id?: string;
        request_hash?: string;
        status?: string;
        response_status?: number | null;
        response_body?: string | null;
      }
    | undefined;

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new IdempotencyKeyConflictError();
    }

    if (existing.status === "completed") {
      return {
        kind: "replay",
        status: Number(existing.response_status ?? 200),
        body: parseStoredBody(existing.response_body),
      };
    }

    return { kind: "processing" };
  }

  const id = randomUUID();

  try {
    db.prepare(
      `INSERT INTO idempotency_operations (
         id, scope, user_id, idempotency_key, request_hash, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'processing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(id, scope, userId, key, requestHash);
  } catch (error) {
    const raced = db
      .prepare(
        `SELECT id, request_hash, status, response_status, response_body
         FROM idempotency_operations
         WHERE scope = ? AND user_id = ? AND idempotency_key = ?
         LIMIT 1`,
      )
      .get(scope, userId, key) as
      | {
          id?: string;
          request_hash?: string;
          status?: string;
          response_status?: number | null;
          response_body?: string | null;
        }
      | undefined;

    if (!raced || raced.request_hash !== requestHash) {
      throw error;
    }

    if (raced.status === "completed") {
      return {
        kind: "replay",
        status: Number(raced.response_status ?? 200),
        body: parseStoredBody(raced.response_body),
      };
    }

    return { kind: "processing" };
  }

  return { kind: "started", id };
}

export function completeIdempotentOperation(input: {
  id: string;
  status: number;
  body: unknown;
}): void {
  ensureSchema();
  db.prepare(
    `UPDATE idempotency_operations
     SET status = 'completed',
         response_status = ?,
         response_body = ?,
         completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(input.status, JSON.stringify(input.body), input.id);
}

export function failIdempotentOperation(id: string): void {
  ensureSchema();
  db.prepare(
    `UPDATE idempotency_operations
     SET status = 'failed',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(id);
}
