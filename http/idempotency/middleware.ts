import type { RequestHandler } from "express";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  failIdempotentOperation,
  hashIdempotencyRequest,
  IdempotencyKeyConflictError,
} from "./idempotency.js";

export function createIdempotencyMiddleware(scope: string): RequestHandler {
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }

    const keyValue = req.headers["idempotency-key"] ?? req.body?.idempotencyKey;
    const key = typeof keyValue === "string" ? keyValue.trim() : "";
    if (!key) {
      next();
      return;
    }

    if (key.length > 200) {
      res.status(400).json({ error: "Idempotency-Key is too long", code: "INVALID_IDEMPOTENCY_KEY" });
      return;
    }

    const userId = typeof (req as any).user?.uid === "string" ? String((req as any).user.uid).trim() : "";
    if (!userId) {
      next();
      return;
    }

    let operation;
    try {
      operation = beginIdempotentOperation({
        scope,
        key,
        userId,
        requestHash: hashIdempotencyRequest({
          method: req.method,
          path: req.path,
          body: req.body ?? null,
        }),
      });
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        res.status(409).json({ error: error.message, code: "IDEMPOTENCY_KEY_REUSED" });
        return;
      }
      next(error);
      return;
    }

    if (operation.kind === "replay") {
      res.status(operation.status).json(operation.body);
      return;
    }

    if (operation.kind === "processing") {
      res.status(409).json({
        error: "This operation is already being processed. Please retry with the same Idempotency-Key shortly.",
        code: "IDEMPOTENCY_IN_PROGRESS",
      });
      return;
    }

    let finalized = false;
    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      if (!finalized) {
        finalized = true;
        try {
          if (res.statusCode >= 200 && res.statusCode < 500) {
            completeIdempotentOperation({ id: operation.id, status: res.statusCode, body });
          } else {
            failIdempotentOperation(operation.id);
          }
        } catch (error) {
          console.error("Failed to persist idempotent operation:", error);
        }
      }
      return originalJson(body);
    }) as typeof res.json;

    res.on("finish", () => {
      if (finalized || res.statusCode < 500) return;
      finalized = true;
      try {
        failIdempotentOperation(operation.id);
      } catch (error) {
        console.error("Failed to release failed idempotent operation:", error);
      }
    });

    next();
  };
}
