import { getPaymentDb } from '../server/postgresCompat.js';

type WebhookRow = {
  id?: number | string;
  provider?: string | null;
  reference?: string | null;
  tx_ref?: string | null;
  event_type?: string | null;
  signature_valid?: number | boolean | null;
  payload?: string | null;
  processing_status?: string | null;
  processed_at?: string | null;
  error?: string | null;
  created_at?: string | null;
};

type PaymentRow = {
  id: string;
  order_id: string;
  provider_reference: string | null;
  paid_at: string | null;
  reference: string;
  raw_response: string | null;
  verification: string | null;
  verified: number | boolean | null;
  updated_at: string;
};

type OrderRow = {
  id: string;
  payment_reference: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  escrow_id: string | null;
  status: string;
  updated_at: string;
};

type EscrowRow = {
  id: string;
  order_id: string;
  state: string;
  balance_amount: number;
  balance_currency: string;
  entries: string | null;
  updated_at: string;
};

function readFlag(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!found) return undefined;
  const value = found.slice(prefix.length).trim();
  return value.length > 0 ? value : undefined;
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toIso(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }
  return new Date().toISOString();
}

function latestWebhookForPayment(db: ReturnType<typeof getPaymentDb>, paymentReference: string): WebhookRow | undefined {
  const rows = db.prepare(
    `SELECT id, provider, reference, tx_ref, event_type, signature_valid, payload, processing_status, processed_at, error, created_at
     FROM payment_webhook_events
     WHERE reference = ? OR tx_ref = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  ).all(paymentReference, paymentReference) as WebhookRow[];

  return rows[0];
}

function latestEscrowReleaseTimestamp(escrow: EscrowRow | undefined): string | null {
  if (!escrow) return null;
  const entries = parseJson<Array<{ entryType?: string; createdAt?: string }>>(escrow.entries, []);
  const releaseEntry = entries.find((entry) => entry.entryType === 'release' && typeof entry.createdAt === 'string' && entry.createdAt.trim());
  return releaseEntry?.createdAt ?? null;
}

function extractProviderReference(payment: PaymentRow | undefined, webhook: WebhookRow | undefined): string | null {
  if (payment?.provider_reference) return payment.provider_reference;

  const webhookPayload = parseJson<Record<string, unknown>>(webhook?.payload, {});
  const rawData = webhookPayload && typeof webhookPayload === 'object' ? webhookPayload : {};

  const candidates: Array<unknown> = [
    (rawData as Record<string, unknown>).reference,
    (rawData as Record<string, unknown>).tx_ref,
    payment?.reference,
  ];

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }

  return null;
}

function extractPaidAt(payment: PaymentRow | undefined, webhook: WebhookRow | undefined): string {
  const webhookPayload = parseJson<Record<string, unknown>>(webhook?.payload, {});
  const completedAt = normalizeText(webhookPayload.completed_at);
  if (completedAt) return completedAt;

  const createdAt = normalizeText(webhook?.created_at);
  if (createdAt) return createdAt;

  const paymentPaidAt = normalizeText(payment?.paid_at);
  if (paymentPaidAt) return paymentPaidAt;

  return new Date().toISOString();
}

function extractFulfilledAt(order: OrderRow | undefined, escrow: EscrowRow | undefined): string {
  const releaseAt = latestEscrowReleaseTimestamp(escrow);
  if (releaseAt) return releaseAt;

  const orderFulfilledAt = normalizeText(order?.fulfilled_at);
  if (orderFulfilledAt) return orderFulfilledAt;

  const orderUpdatedAt = normalizeText(order?.updated_at);
  if (orderUpdatedAt) return orderUpdatedAt;

  return new Date().toISOString();
}

function main(): void {
  const orderId = readArg('order-id') ?? process.env.ORDER_ID?.trim();
  const paymentReferenceInput = readArg('payment-reference') ?? process.env.PAYMENT_REFERENCE?.trim();
  const dryRun = readFlag('DRY_RUN');

  if (!orderId && !paymentReferenceInput) {
    throw new Error('Provide ORDER_ID or PAYMENT_REFERENCE.');
  }

  const db = getPaymentDb();

  const run = db.transaction(() => {
    const payment = paymentReferenceInput
      ? (db.prepare(
          `SELECT id, order_id, provider_reference, paid_at, reference, raw_response, verification, verified, updated_at
           FROM payments
           WHERE reference = ? OR provider_reference = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        ).get(paymentReferenceInput, paymentReferenceInput) as PaymentRow | undefined)
      : undefined;

    const order = orderId
      ? (db.prepare(
          `SELECT id, payment_reference, paid_at, fulfilled_at, escrow_id, status, updated_at
           FROM orders
           WHERE id = ?
           LIMIT 1`,
        ).get(orderId) as OrderRow | undefined)
      : payment
        ? (db.prepare(
            `SELECT id, payment_reference, paid_at, fulfilled_at, escrow_id, status, updated_at
             FROM orders
             WHERE id = ? OR payment_reference = ?
             ORDER BY updated_at DESC
             LIMIT 1`,
          ).get(payment.order_id, payment.reference) as OrderRow | undefined)
        : undefined;

    if (!payment && !order) {
      throw new Error('No matching payment or order found.');
    }

    const resolvedPayment = payment ?? (order?.payment_reference
      ? (db.prepare(
          `SELECT id, order_id, provider_reference, paid_at, reference, raw_response, verification, verified, updated_at
           FROM payments
           WHERE reference = ? OR provider_reference = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        ).get(order.payment_reference, order.payment_reference) as PaymentRow | undefined)
      : undefined);

    const resolvedOrder = order ?? (resolvedPayment
      ? (db.prepare(
          `SELECT id, payment_reference, paid_at, fulfilled_at, escrow_id, status, updated_at
           FROM orders
           WHERE id = ? OR payment_reference = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
        ).get(resolvedPayment.order_id, resolvedPayment.reference) as OrderRow | undefined)
      : undefined);

    if (!resolvedOrder) {
      throw new Error('Order could not be resolved from the provided identifiers.');
    }

    const escrow = (resolvedOrder.escrow_id
      ? (db.prepare(
          `SELECT id, order_id, state, balance_amount, balance_currency, entries, updated_at
           FROM escrows
           WHERE id = ? OR order_id = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
        ).get(resolvedOrder.escrow_id, resolvedOrder.id) as EscrowRow | undefined)
      : (db.prepare(
          `SELECT id, order_id, state, balance_amount, balance_currency, entries, updated_at
           FROM escrows
           WHERE order_id = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
        ).get(resolvedOrder.id) as EscrowRow | undefined));

    const paymentReference = resolvedPayment?.reference ?? resolvedOrder.payment_reference ?? paymentReferenceInput ?? null;
    if (!paymentReference) {
      throw new Error('Could not determine a payment reference for this repair.');
    }

    const webhook = latestWebhookForPayment(db, paymentReference);
    const providerReference = extractProviderReference(resolvedPayment, webhook);
    const paidAt = extractPaidAt(resolvedPayment, webhook);
    const fulfilledAt = extractFulfilledAt(resolvedOrder, escrow);
    const escrowId = escrow?.id ?? resolvedOrder.escrow_id ?? null;
    const now = new Date().toISOString();

    if (dryRun) {
      console.log(JSON.stringify({
        orderId: resolvedOrder.id,
        paymentReference,
        providerReference,
        paidAt,
        fulfilledAt,
        escrowId,
        webhookReference: webhook?.reference ?? null,
        webhookTxRef: webhook?.tx_ref ?? null,
      }, null, 2));
      return;
    }

    if (resolvedPayment) {
      db.prepare(
        `UPDATE payments
         SET order_id = COALESCE(order_id, ?),
             provider_reference = COALESCE(?, provider_reference),
             paid_at = COALESCE(?, paid_at),
             verified = CASE WHEN verified = 1 THEN 1 ELSE 1 END,
             updated_at = ?
         WHERE id = ?`,
      ).run(resolvedOrder.id, providerReference, paidAt, now, resolvedPayment.id);
    }

    db.prepare(
      `UPDATE orders
       SET payment_reference = COALESCE(?, payment_reference),
           paid_at = COALESCE(?, paid_at),
           fulfilled_at = COALESCE(?, fulfilled_at),
           escrow_id = COALESCE(?, escrow_id),
           status = CASE WHEN status = 'fulfilled' THEN status ELSE 'fulfilled' END,
           updated_at = ?
       WHERE id = ?`,
    ).run(paymentReference, paidAt, fulfilledAt, escrowId, now, resolvedOrder.id);

    if (escrow) {
      const entries = parseJson<Array<Record<string, unknown>>>(escrow.entries, []);
      const hasRelease = entries.some((entry) => entry.entryType === 'release');
      const nextEntries = hasRelease
        ? entries
        : [
            ...entries,
            {
              id: `repair-${resolvedOrder.id}-${Date.now()}`,
              escrowId: escrow.id,
              entryType: 'release',
              amount: Number(escrow.balance_amount ?? 0),
              currency: escrow.balance_currency ?? 'MWK',
              balanceAfter: 0,
              note: 'Escrow release reconstructed during transaction chain repair',
              createdAt: fulfilledAt,
            },
          ];

      db.prepare(
        `UPDATE escrows
         SET order_id = COALESCE(order_id, ?),
             state = 'released',
             balance_amount = 0,
             entries = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(resolvedOrder.id, JSON.stringify(nextEntries), now, escrow.id);
    }

    if (webhook?.id !== undefined) {
      db.prepare(
        `UPDATE payment_webhook_events
         SET processing_status = 'processed',
             processed_at = COALESCE(processed_at, ?),
             signature_valid = COALESCE(signature_valid, 1),
             error = NULL
         WHERE id = ?`,
      ).run(now, webhook.id);
    }

    console.log(`Repaired transaction chain for order ${resolvedOrder.id}`);
    console.log(JSON.stringify({
      orderId: resolvedOrder.id,
      paymentReference,
      providerReference,
      paidAt,
      fulfilledAt,
      escrowId,
      webhookReference: webhook?.reference ?? null,
      webhookTxRef: webhook?.tx_ref ?? null,
    }, null, 2));
  });

  run();
}

try {
  main();
} catch (error) {
  console.error('Transaction chain repair failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}