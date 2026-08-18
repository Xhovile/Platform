import type { PaymentIntentStatus } from '../../../src/shared/types/payment.js';
import type { PaymentResult, PaymentVerificationResult } from '../../../src/modules/payments/types.js';
import { getPaymentDb } from '../../postgresCompat.js';
import { query, withTransaction } from '../../postgres.js';
import type { PoolClient } from 'pg';

export interface StoredPayment extends PaymentResult {
  verified?: boolean;
  verification?: PaymentVerificationResult;
}

type DbExecutor = Pick<PoolClient, 'query'>;

const PAYMENT_ALLOWED_TRANSITIONS: Readonly<Record<PaymentIntentStatus, readonly PaymentIntentStatus[]>> = {
  pending: ['pending', 'requires_action', 'authorized', 'captured', 'failed', 'cancelled'],
  requires_action: ['requires_action', 'authorized', 'captured', 'failed', 'cancelled'],
  authorized: ['authorized', 'captured', 'failed', 'cancelled'],
  captured: ['captured', 'refunded'],
  failed: ['failed', 'captured', 'cancelled'],
  cancelled: ['cancelled'],
  refunded: ['refunded'],
} as const;

function assertPaymentStatusTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): void {
  if (PAYMENT_ALLOWED_TRANSITIONS[from].includes(to)) return;
  throw new Error(`Illegal payment state transition: ${from} -> ${to}`);
}

export class PostgresPaymentRepository {
  private get db() { return getPaymentDb(); }

  save(payment: StoredPayment): StoredPayment {
    const updateStmt = this.db.prepare(`
      UPDATE payments SET id=@id, order_id=@order_id, provider=@provider, method=@method,
        status=@status, provider_reference=@provider_reference, currency=@currency, amount=@amount,
        checkout_url=@checkout_url, paid_at=@paid_at, raw_response=@raw_response, verified=@verified,
        verification=@verification, updated_at=@updated_at WHERE reference=@reference
    `);
    const insertStmt = this.db.prepare(`
      INSERT INTO payments (id, order_id, provider, method, status, reference, provider_reference,
        currency, amount, checkout_url, paid_at, raw_response, verified, verification, created_at, updated_at)
      VALUES (@id,@order_id,@provider,@method,@status,@reference,@provider_reference,@currency,@amount,
        @checkout_url,@paid_at,@raw_response,@verified,@verification,@created_at,@updated_at)
    `);
    this.db.transaction((p: StoredPayment) => {
      const values = {
        id:p.id, order_id:p.orderId, provider:p.provider, method:p.method, status:p.status, reference:p.reference,
        provider_reference:p.providerReference ?? null, currency:p.amount.currency, amount:p.amount.amount,
        checkout_url:p.checkoutUrl ?? null, paid_at:p.paidAt ?? null,
        raw_response:p.rawResponse ? JSON.stringify(p.rawResponse) : null, verified:p.verified ? 1 : 0,
        verification:p.verification ? JSON.stringify(p.verification) : null, created_at:p.createdAt, updated_at:p.updatedAt,
      };
      const result = updateStmt.run(values);
      if (result.changes === 0) insertStmt.run(values);
    })(payment);
    return payment;
  }

  findByReference(reference: string): StoredPayment | undefined {
    const row = this.db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference) as Record<string, unknown> | undefined;
    return row ? this.rowToPayment(row) : undefined;
  }

  updateByReference(reference: string, updater: (payment: StoredPayment) => StoredPayment): StoredPayment | undefined {
    const current = this.findByReference(reference);
    if (!current) return undefined;
    const next = updater(current);
    assertPaymentStatusTransition(current.status, next.status);
    return this.save(next);
  }

  clear(): void {
    this.db.prepare('DELETE FROM payment_webhook_events').run();
    this.db.prepare('DELETE FROM payments').run();
  }

  async findByReferenceAsync(reference: string, executor: DbExecutor = { query }): Promise<StoredPayment | undefined> {
    const result = await executor.query<Record<string, unknown>>('SELECT * FROM payments WHERE reference = $1', [reference]);
    const row = result.rows[0];
    return row ? this.rowToPayment(row) : undefined;
  }

  private async saveAsyncOnExecutor(payment: StoredPayment, executor: DbExecutor): Promise<StoredPayment> {
    const values = [
      payment.id, payment.orderId, payment.provider, payment.method, payment.status, payment.reference,
      payment.providerReference ?? null, payment.amount.currency, payment.amount.amount, payment.checkoutUrl ?? null,
      payment.paidAt ?? null, payment.rawResponse ? JSON.stringify(payment.rawResponse) : null,
      payment.verified ? 1 : 0, payment.verification ? JSON.stringify(payment.verification) : null,
      payment.createdAt, payment.updatedAt,
    ];

    const updated = await executor.query(
      `UPDATE payments SET id=$1, order_id=$2, provider=$3, method=$4, status=$5, provider_reference=$7,
        currency=$8, amount=$9, checkout_url=$10, paid_at=$11, raw_response=$12, verified=$13,
        verification=$14, updated_at=$16 WHERE reference=$6`,
      values,
    );

    if ((updated.rowCount ?? 0) === 0) {
      await executor.query(
        `INSERT INTO payments (id,order_id,provider,method,status,reference,provider_reference,currency,amount,
          checkout_url,paid_at,raw_response,verified,verification,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        values,
      );
    }
    return payment;
  }

  async saveAsync(payment: StoredPayment, executor?: DbExecutor): Promise<StoredPayment> {
    if (executor) return this.saveAsyncOnExecutor(payment, executor);
    return withTransaction((client) => this.saveAsyncOnExecutor(payment, client));
  }

  async updateByReferenceAsync(
    reference: string,
    updater: (payment: StoredPayment) => StoredPayment,
    executor?: DbExecutor,
  ): Promise<StoredPayment | undefined> {
    const run = async (client: DbExecutor) => {
      const current = await this.findByReferenceAsync(reference, client);
      if (!current) return undefined;
      const next = updater(current);
      assertPaymentStatusTransition(current.status, next.status);
      return this.saveAsyncOnExecutor(next, client);
    };
    return executor ? run(executor) : withTransaction(run);
  }

  private rowToPayment(row: Record<string, unknown>): StoredPayment {
    let rawResponse: Record<string, unknown> | undefined;
    try { rawResponse = row.raw_response ? JSON.parse(row.raw_response as string) as Record<string, unknown> : undefined; } catch { rawResponse = undefined; }
    let verification: PaymentVerificationResult | undefined;
    try { verification = row.verification ? JSON.parse(row.verification as string) as PaymentVerificationResult : undefined; } catch { verification = undefined; }
    return {
      id: row.id as string, orderId: row.order_id as string, provider: row.provider as StoredPayment['provider'],
      method: row.method as StoredPayment['method'], status: row.status as StoredPayment['status'], reference: row.reference as string,
      providerReference: (row.provider_reference as string | null) ?? null,
      amount: { amount: Number(row.amount ?? 0), currency: String(row.currency ?? 'MWK') },
      checkoutUrl: (row.checkout_url as string | null) ?? null, paidAt: (row.paid_at as string | null) ?? null,
      rawResponse, verified: row.verified === 1 || row.verified === true, verification,
      createdAt: row.created_at as string, updatedAt: row.updated_at as string,
    };
  }
}

export const paymentRepository = new PostgresPaymentRepository();
