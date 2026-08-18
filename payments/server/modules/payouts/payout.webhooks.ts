import type { Request, Response } from "express";
import { createHash } from "crypto";
import { paychanguProvider, normalizePaychanguStatus } from "../payments/paychangu.provider.js";
import { getPayChanguPayoutStatus } from './paychangu.payout.js';
import { getPaymentDb } from "../../postgresCompat.js";
import {
  findPaymentWebhookDuplicate,
  insertPaymentWebhookEvent,
  recordPaymentWebhookDuplicateAttempt,
  updatePaymentWebhookEventStatus,
} from "../../postgresCompat/webhooks.js";

type PayoutWebhookContext = {
  signature?: string | undefined;
  payload: string | Buffer | Record<string, unknown>;
};

type ParsedWebhookPayload = {
  rawPayload: string;
  parsedPayload: Record<string, unknown> | null;
};

type PayoutWebhookResponse =
  | { ok: true; status: "processed" | "ignored" | "duplicate"; payoutId?: string | null }
  | { ok: false; error: string };

function getHeaderValue(req: Request, headerNames: string[]): string | undefined {
  for (const name of headerNames) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === "string" && first.trim()) return first.trim();
    } else if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function bodyToRawString(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (payload && typeof payload === "object") return JSON.stringify(payload);
  return "";
}

function parseRawWebhookPayload(payload: string | Buffer | Record<string, unknown>): ParsedWebhookPayload {
  const rawPayload = bodyToRawString(payload);
  if (!rawPayload) {
    return { rawPayload: "", parsedPayload: null };
  }

  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    return {
      rawPayload,
      parsedPayload: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null,
    };
  } catch {
    return { rawPayload, parsedPayload: null };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractNestedObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function resolvePayoutRow(payoutId: string, chargeId: string): Record<string, unknown> | undefined {
  const db = getPaymentDb();
  return (
    (payoutId
      ? (db.prepare(`SELECT * FROM payouts WHERE id = ? LIMIT 1`).get(payoutId) as Record<string, unknown> | undefined)
      : undefined) ??
    (chargeId
      ? (db.prepare(`SELECT * FROM payouts WHERE provider_charge_id = ? LIMIT 1`).get(chargeId) as Record<string, unknown> | undefined)
      : undefined)
  );
}

async function handlePaychanguWebhookInternal(
  context: PayoutWebhookContext,
): Promise<PayoutWebhookResponse> {
  const { rawPayload, parsedPayload } = parseRawWebhookPayload(context.payload);
  const payloadHash = sha256(rawPayload);

  if (!parsedPayload) {
    return { ok: false, error: "Invalid PayChangu payout webhook payload" };
  }

  const eventType = readString(parsedPayload.event_type, parsedPayload.event);
  const eventId = readString(parsedPayload.event_id, parsedPayload.eventId);
  const transaction = extractNestedObject(extractNestedObject(parsedPayload.data)?.transaction) ?? extractNestedObject(parsedPayload.data);
  const payoutId = readString(transaction?.payout_reference, parsedPayload.payout_reference, parsedPayload.payoutId, parsedPayload.reference);
  const chargeId = readString(transaction?.charge_id, parsedPayload.charge_id, parsedPayload.tx_ref, parsedPayload.txRef, payoutId);
  const providerReference = readString(transaction?.reference, parsedPayload.reference);
  const providerTransactionId = readString(transaction?.transaction_id, parsedPayload.transaction_id);
  const providerStatus = normalizePaychanguStatus(readString(transaction?.status, parsedPayload.status));
  const secret = process.env.PAYCHANGU_PAYOUT_WEBHOOK_SECRET || process.env.PAYCHANGU_WEBHOOK_SECRET;

  const verified = await paychanguProvider.verifyWebhook(context.signature, rawPayload, {
    paychanguWebhookSecret: secret,
  });

  const webhookInput = {
    provider: "paychangu_payout",
    providerEventId: eventId || null,
    reference: chargeId || payoutId || null,
    txRef: chargeId || payoutId || null,
    eventType: eventType || null,
    payloadHash,
    processingStatus: "received",
    signatureValid: verified.valid,
    payload: rawPayload,
    createdAt: new Date().toISOString(),
  };

  if (!verified.valid) {
    const inserted = insertPaymentWebhookEvent({
      ...webhookInput,
      processingStatus: "rejected",
      error: "Invalid PayChangu payout webhook signature",
    });

    if (inserted.inserted === false) {
      recordPaymentWebhookDuplicateAttempt(webhookInput, inserted.existingId);
    }

    throw new Error("Invalid PayChangu payout webhook signature");
  }

  const payoutRow = resolvePayoutRow(payoutId, chargeId);

  const duplicate = findPaymentWebhookDuplicate(webhookInput);
  if (duplicate) {
    const db = getPaymentDb();
    if (payoutRow) {
      db.prepare(
        `INSERT INTO payout_events (
          payout_id,
          seller_id,
          event_type,
          actor_type,
          actor_id,
          note,
          payload,
          created_at
        ) VALUES (?, ?, 'payout_webhook_duplicate', 'system', NULL, ?, ?, ?)`,
      ).run(
        String(payoutRow.id),
        String(payoutRow.seller_id ?? ""),
        `Duplicate PayChangu payout webhook event ${eventId || chargeId || payoutId || "unknown"}`,
        rawPayload,
        new Date().toISOString(),
      );
    }

    recordPaymentWebhookDuplicateAttempt(webhookInput, duplicate.id);
    return { ok: true, status: "duplicate", payoutId: payoutId || null };
  }

  const inserted = insertPaymentWebhookEvent(webhookInput);
  if (inserted.inserted === false) {
    if (payoutRow) {
      getPaymentDb().prepare(
        `INSERT INTO payout_events (
          payout_id,
          seller_id,
          event_type,
          actor_type,
          actor_id,
          note,
          payload,
          created_at
        ) VALUES (?, ?, 'payout_webhook_duplicate', 'system', NULL, ?, ?, ?)`,
      ).run(
        String(payoutRow.id),
        String(payoutRow.seller_id ?? ""),
        `Duplicate PayChangu payout webhook event ${eventId || chargeId || payoutId || "unknown"}`,
        rawPayload,
        new Date().toISOString(),
      );
    }

    recordPaymentWebhookDuplicateAttempt(webhookInput, inserted.existingId);
    return { ok: true, status: "duplicate", payoutId: payoutId || null };
  }

  const db = getPaymentDb();
  const payout = payoutRow;

  if (!payout) {
    updatePaymentWebhookEventStatus(inserted.id, "ignored", {
      processedAt: new Date().toISOString(),
      error: `No matching payout found for ${payoutId || chargeId || "unknown reference"}`,
      signatureValid: true,
    });
    return { ok: true, status: "ignored", payoutId: payoutId || null };
  }

  const resolvedPayoutId = String(payout.id ?? payoutId ?? chargeId ?? "");
  const resolvedSellerId = String(payout.seller_id ?? "");

  // Verify the webhook against PayChangu before changing the payout state.
  const providerChargeForVerification = chargeId || String(payout.provider_charge_id ?? '').trim();
  if (!providerChargeForVerification) {
    throw new Error('PayChangu payout webhook is missing charge_id; cannot verify transaction');
  }
  const verifiedPayout = await getPayChanguPayoutStatus(providerChargeForVerification);
  const verifiedStatus = verifiedPayout.status;
  const verifiedReference = verifiedPayout.reference || providerReference || null;
  const verifiedTransactionId = verifiedPayout.transactionId || providerTransactionId || null;
  const verifiedAmount = verifiedPayout.amount;
  const verifiedCurrency = verifiedPayout.currency;
  const now = new Date().toISOString();
  const payoutState = verifiedStatus === "paid"
    ? "paid"
    : verifiedStatus === "failed"
      ? "failed"
      : "pending";

  const payloadAmount = readNumber(transaction?.amount, parsedPayload.amount, extractNestedObject(parsedPayload.data)?.amount);
  const payoutAmount = Number.isFinite(payloadAmount as number) ? Math.round(payloadAmount as number) : Number(payout.amount ?? 0);
  const payoutCurrency = readString(transaction?.currency, parsedPayload.currency, String(payout.currency ?? "MWK")) || "MWK";

  db.prepare(
    `UPDATE payouts
     SET status = ?,
         provider_status = ?,
         provider_ref_id = COALESCE(?, provider_ref_id),
         provider_transaction_id = COALESCE(?, provider_transaction_id),
         amount = COALESCE(?, amount),
         currency = COALESCE(?, currency),
         raw_response = ?,
         paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, ?) ELSE paid_at END,
         failed_at = CASE WHEN ? = 'failed' THEN COALESCE(failed_at, ?) ELSE failed_at END,
         failure_reason = CASE WHEN ? = 'failed' THEN COALESCE(failure_reason, 'Provider callback reported payout failure') ELSE failure_reason END,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    payoutState,
    providerStatus,
    verifiedReference,
    verifiedTransactionId,
    verifiedAmount ?? payoutAmount,
    verifiedCurrency ?? payoutCurrency,
    rawPayload,
    payoutState,
    now,
    payoutState,
    now,
    payoutState,
    now,
    resolvedPayoutId,
  );

  const latestAttempt = db.prepare(
    `SELECT id
     FROM payout_attempts
     WHERE payout_id = ?
     ORDER BY attempt_no DESC, created_at DESC
     LIMIT 1`,
  ).get(resolvedPayoutId) as { id?: string } | undefined;

  if (latestAttempt?.id) {
    db.prepare(
      `UPDATE payout_attempts
       SET status = ?,
           response_payload = ?,
           completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE id = ?`,
    ).run(
      payoutState,
      rawPayload,
      now,
      now,
      latestAttempt.id,
    );
  }

  db.prepare(
    `INSERT INTO payout_events (
      payout_id,
      seller_id,
      event_type,
      actor_type,
      actor_id,
      note,
      payload,
      created_at
    ) VALUES (?, ?, ?, 'system', NULL, ?, ?, ?)`,
  ).run(
    resolvedPayoutId,
    resolvedSellerId,
    payoutState === "paid" ? "payout_reconciled" : payoutState === "failed" ? "payout_webhook_failed" : "payout_webhook_pending",
    payoutState === "paid"
      ? "PayChangu payout webhook confirmed payout completion"
      : payoutState === "failed"
        ? "PayChangu payout webhook reported payout failure"
        : "PayChangu payout webhook reported pending payout status",
    rawPayload,
    now,
  );

  updatePaymentWebhookEventStatus(inserted.id, "processed", {
    processedAt: now,
    signatureValid: true,
  });

  return { ok: true, status: "processed", payoutId: resolvedPayoutId };
}

async function payoutWebhookRouteHandler(req: Request, res: Response) {
  try {
    const signature = getHeaderValue(req, ["x-paychangu-signature", "signature"]);
    const result = await handlePaychanguWebhookInternal({
      signature,
      payload: req.body as Buffer | string | Record<string, unknown>,
    });

    if (result.ok === false) {
      return res.status(401).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payout webhook processing failed";
    if (message.includes("Invalid PayChangu payout webhook signature")) {
      return res.status(401).json({ error: message });
    }
    return res.status(500).json({ error: message });
  }
}

function handlePaychanguWebhook(
  contextOrSignature: PayoutWebhookContext | string | undefined,
  payload?: PayoutWebhookContext["payload"],
): Promise<PayoutWebhookResponse> {
  if (typeof contextOrSignature !== "object") {
    return handlePaychanguWebhookInternal({ signature: contextOrSignature, payload: payload ?? "" });
  }

  return handlePaychanguWebhookInternal(contextOrSignature);
}

export const payoutWebhookHandler = Object.assign(payoutWebhookRouteHandler, {
  handlePaychanguWebhook,
});
