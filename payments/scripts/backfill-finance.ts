import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPaymentDb } from '../server/postgresCompat.js';

type TableName =
  | 'payments'
  | 'orders'
  | 'escrows'
  | 'payment_webhook_events'
  | 'seller_payout_accounts'
  | 'payouts'
  | 'payout_attempts'
  | 'payout_events'
  | 'payout_adjustments'
  | 'seller_payout_account_events';

const DEFAULT_TABLES: TableName[] = [
  'payments',
  'orders',
  'escrows',
  'payment_webhook_events',
  'seller_payout_accounts',
  'payouts',
  'payout_attempts',
  'payout_events',
  'payout_adjustments',
  'seller_payout_account_events',
];

type SqliteRow = Record<string, unknown>;

type RepairStats = {
  table: string;
  sqliteRows: number;
  postgresRowsBefore: number;
  postgresRowsAfter: number;
  imported: number;
  updated: number;
  skipped: number;
};

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableExistsSqlite(dbPath: string, table: string): boolean {
  const escaped = table.replace(/'/g, "''");
  const result = spawnSync('sqlite3', [dbPath, '-noheader', '-batch', `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${escaped}' LIMIT 1;`], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Failed to check whether SQLite table ${table} exists`);
  }

  return result.stdout.trim().length > 0;
}

function loadSqliteRows(dbPath: string, table: string): SqliteRow[] {
  const result = spawnSync('sqlite3', [dbPath, '-json', `SELECT * FROM ${table};`], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Failed to read SQLite table ${table}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) return [];

  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Unexpected SQLite JSON output for ${table}`);
  }

  return parsed as SqliteRow[];
}

function loadPostgresColumns(table: string): string[] {
  const db = getPaymentDb();
  const rows = db.prepare(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = @table
     ORDER BY ordinal_position`,
  ).all({ table }) as Array<{ column_name: string }>;

  return rows.map((row) => row.column_name);
}

function countPostgresRows(table: string): number {
  const db = getPaymentDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`).get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function resolveConflictColumns(table: TableName, columns: string[]): string[] {
  if (table === 'payments') {
    return columns.includes('reference') ? ['reference'] : ['id'];
  }
  return ['id'];
}

function buildUpsertSql(table: TableName, columns: string[]): string {
  const insertColumns = columns.map(quoteIdent).join(', ');
  const values = columns.map((column) => `@${column}`).join(', ');
  const conflictTarget = resolveConflictColumns(table, columns);
  const conflictColumns = conflictTarget.map(quoteIdent).join(', ');
  const updateColumns = columns.filter((column) => !conflictTarget.includes(column));

  if (updateColumns.length === 0) {
    return `INSERT INTO ${quoteIdent(table)} (${insertColumns}) VALUES (${values}) ON CONFLICT (${conflictColumns}) DO NOTHING`;
  }

  const updates = updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ');
  return `INSERT INTO ${quoteIdent(table)} (${insertColumns}) VALUES (${values}) ON CONFLICT (${conflictColumns}) DO UPDATE SET ${updates}`;
}

function toIsoIfDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function normalizePaymentWebhookPayload(row: SqliteRow): SqliteRow {
  const next = { ...row };
  if (typeof next.payload === 'string' && next.payload.trim()) {
    try {
      next.payload = JSON.stringify(JSON.parse(next.payload));
    } catch {
      // keep original text if it is not valid JSON
    }
  }
  return next;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractWebhookByReference(webhooks: SqliteRow[], reference: string | null | undefined): SqliteRow | undefined {
  if (!reference) return undefined;
  return webhooks.find((row) => String(row.reference ?? '') === reference || String(row.tx_ref ?? '') === reference);
}

function extractReleaseTimestamp(escrowRow: SqliteRow | undefined): string | null {
  if (!escrowRow) return null;
  const entries = parseJsonField<Array<{ entryType?: string; createdAt?: string }>>(escrowRow.entries, []);
  const releaseEntry = entries.find((entry) => entry.entryType === 'release' && typeof entry.createdAt === 'string' && entry.createdAt.trim());
  return releaseEntry?.createdAt ?? null;
}

function repairPaymentAndOrderLinks(
  payments: SqliteRow[],
  orders: SqliteRow[],
  escrows: SqliteRow[],
  webhooks: SqliteRow[],
): {
  payments: SqliteRow[];
  orders: SqliteRow[];
} {
  const paymentsByReference = new Map<string, SqliteRow>();
  const paymentsByOrderId = new Map<string, SqliteRow>();
  const escrowsByOrderId = new Map<string, SqliteRow>();

  for (const payment of payments) {
    const reference = String(payment.reference ?? '').trim();
    const orderId = String(payment.order_id ?? '').trim();
    if (reference) paymentsByReference.set(reference, payment);
    if (orderId) paymentsByOrderId.set(orderId, payment);
  }

  for (const escrow of escrows) {
    const orderId = String(escrow.order_id ?? '').trim();
    if (orderId) escrowsByOrderId.set(orderId, escrow);
  }

  const repairedPayments = payments.map((payment) => {
    const reference = String(payment.reference ?? '').trim();
    const webhook = extractWebhookByReference(webhooks, reference);
    const next = { ...payment };

    if (!next.provider_reference) {
      const rawResponse = typeof next.raw_response === 'string' ? parseJsonField<Record<string, unknown>>(next.raw_response, {}) : {};
      const rawData = rawResponse && typeof rawResponse.data === 'object' && rawResponse.data !== null ? rawResponse.data as Record<string, unknown> : {};
      const authorization = rawData.authorization && typeof rawData.authorization === 'object' ? rawData.authorization as Record<string, unknown> : undefined;
      const mobileMoney = authorization?.mobile_money && typeof authorization.mobile_money === 'object' ? authorization.mobile_money as Record<string, unknown> : undefined;

      next.provider_reference =
        webhook?.reference ??
        (typeof rawData.reference === 'string' ? rawData.reference : null) ??
        (typeof rawResponse.reference === 'string' ? rawResponse.reference : null) ??
        (typeof mobileMoney?.trans_id === 'string' ? mobileMoney.trans_id : null) ??
        null;
    }

    if (!next.paid_at) {
      const rawResponse = typeof next.raw_response === 'string' ? parseJsonField<Record<string, unknown>>(next.raw_response, {}) : {};
      next.paid_at =
        webhook?.completed_at ??
        webhook?.created_at ??
        (typeof rawResponse.completed_at === 'string' ? rawResponse.completed_at : null) ??
        next.updated_at ??
        null;
    }

    return next;
  });

  const repairedOrders = orders.map((order) => {
    const next = { ...order };
    const payment = paymentsByOrderId.get(String(order.id ?? '').trim()) || paymentsByReference.get(String(order.payment_reference ?? '').trim()) || payments.find((row) => String(row.order_id ?? '').trim() === String(order.id ?? '').trim());
    const escrow = escrowsByOrderId.get(String(order.id ?? '').trim());

    if (!next.payment_reference && payment?.reference) {
      next.payment_reference = payment.reference;
    }

    if (!next.paid_at) {
      next.paid_at =
        payment?.paid_at ??
        extractWebhookByReference(webhooks, String(payment?.reference ?? next.payment_reference ?? '').trim())?.completed_at ??
        extractWebhookByReference(webhooks, String(payment?.reference ?? next.payment_reference ?? '').trim())?.created_at ??
        payment?.updated_at ??
        null;
    }

    if (!next.escrow_id && escrow?.id) {
      next.escrow_id = escrow.id;
    }

    if (!next.fulfilled_at) {
      next.fulfilled_at =
        extractReleaseTimestamp(escrow) ??
        (String(next.status ?? '').trim().toLowerCase() === 'fulfilled' ? next.updated_at ?? null : null);
    }

    return next;
  });

  return { payments: repairedPayments, orders: repairedOrders };
}

function normalizeSourceRows(table: TableName, rows: SqliteRow[]): SqliteRow[] {
  if (table === 'payment_webhook_events') {
    return rows.map(normalizePaymentWebhookPayload).map((row) => ({
      ...row,
      created_at: toIsoIfDate(row.created_at),
      processed_at: toIsoIfDate(row.processed_at),
    }));
  }

  return rows.map((row) => {
    const next: SqliteRow = { ...row };
    for (const [key, value] of Object.entries(next)) {
      if (key.endsWith('_at') || key === 'created_at' || key === 'updated_at' || key === 'paid_at' || key === 'fulfilled_at' || key === 'verified_at' || key === 'sent_at' || key === 'failed_at' || key === 'requested_at') {
        next[key] = toIsoIfDate(value);
      }
    }
    return next;
  });
}

function pickColumnsForDestination(table: TableName, sourceRow: SqliteRow, destinationColumns: string[]): SqliteRow {
  const next: SqliteRow = {};
  for (const column of destinationColumns) {
    if (Object.prototype.hasOwnProperty.call(sourceRow, column)) {
      next[column] = sourceRow[column];
    }
  }

  if (table === 'payments') {
    if (!Object.prototype.hasOwnProperty.call(next, 'provider_reference')) {
      next.provider_reference = sourceRow.provider_reference ?? null;
    }
    if (!Object.prototype.hasOwnProperty.call(next, 'paid_at')) {
      next.paid_at = sourceRow.paid_at ?? null;
    }
  }

  return next;
}

function upsertRows(table: TableName, rows: SqliteRow[]): { imported: number; updated: number; skipped: number } {
  const db = getPaymentDb();
  const destinationColumns = loadPostgresColumns(table);
  if (destinationColumns.length === 0) {
    throw new Error(`PostgreSQL table ${table} does not exist or has no columns`);
  }

  const insertColumns = destinationColumns.filter((column) => rows.some((row) => Object.prototype.hasOwnProperty.call(row, column)));
  if (insertColumns.length === 0) {
    return { imported: 0, updated: 0, skipped: rows.length };
  }

  const sql = buildUpsertSql(table, insertColumns);
  const statement = db.prepare(sql);
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const sourceRow of rows) {
    const payload = pickColumnsForDestination(table, sourceRow, insertColumns);
    if (Object.keys(payload).length === 0) {
      skipped += 1;
      continue;
    }

    const result = statement.run(payload) as { changes?: number };
    if ((result.changes ?? 0) > 0) {
      updated += 1;
    } else {
      imported += 1;
    }
  }

  return { imported, updated, skipped };
}

function repairPgLinks(): void {
  const db = getPaymentDb();

  const payments = db.prepare('SELECT id, order_id, reference, provider_reference, paid_at, raw_response, updated_at FROM payments ORDER BY created_at ASC').all() as SqliteRow[];
  const orders = db.prepare('SELECT id, payment_reference, paid_at, fulfilled_at, escrow_id, status, updated_at FROM orders ORDER BY created_at ASC').all() as SqliteRow[];
  const escrows = db.prepare('SELECT id, order_id, state, entries, updated_at FROM escrows ORDER BY created_at ASC').all() as SqliteRow[];
  const webhooks = db.prepare('SELECT id, provider, reference, tx_ref, event_type, signature_valid, payload, created_at, completed_at, processed_at FROM payment_webhook_events ORDER BY created_at ASC').all() as SqliteRow[];

  const paymentByReference = new Map<string, SqliteRow>();
  const paymentByOrderId = new Map<string, SqliteRow>();
  const webhookByTxRef = new Map<string, SqliteRow>();
  const webhookByReference = new Map<string, SqliteRow>();
  const escrowByOrderId = new Map<string, SqliteRow>();

  for (const payment of payments) {
    const reference = String(payment.reference ?? '').trim();
    const orderId = String(payment.order_id ?? '').trim();
    if (reference) paymentByReference.set(reference, payment);
    if (orderId) paymentByOrderId.set(orderId, payment);
  }

  for (const webhook of webhooks) {
    const txRef = String(webhook.tx_ref ?? '').trim();
    const reference = String(webhook.reference ?? '').trim();
    if (txRef) webhookByTxRef.set(txRef, webhook);
    if (reference) webhookByReference.set(reference, webhook);
  }

  for (const escrow of escrows) {
    const orderId = String(escrow.order_id ?? '').trim();
    if (orderId) escrowByOrderId.set(orderId, escrow);
  }

  const fixPayment = db.prepare(
    `UPDATE payments
     SET provider_reference = @provider_reference,
         paid_at = COALESCE(@paid_at, paid_at),
         updated_at = COALESCE(@updated_at, updated_at)
     WHERE id = @id`,
  );

  const fixOrder = db.prepare(
    `UPDATE orders
     SET payment_reference = COALESCE(@payment_reference, payment_reference),
         paid_at = COALESCE(@paid_at, paid_at),
         fulfilled_at = COALESCE(@fulfilled_at, fulfilled_at),
         escrow_id = COALESCE(@escrow_id, escrow_id),
         updated_at = COALESCE(@updated_at, updated_at)
     WHERE id = @id`,
  );

  for (const payment of payments) {
    const reference = String(payment.reference ?? '').trim();
    const webhook = webhookByTxRef.get(reference) ?? webhookByReference.get(reference);
    const rawResponse = typeof payment.raw_response === 'string' ? parseJsonField<Record<string, unknown>>(payment.raw_response, {}) : {};
    const rawData = rawResponse && typeof rawResponse.data === 'object' && rawResponse.data !== null ? rawResponse.data as Record<string, unknown> : {};
    const authorization = rawData.authorization && typeof rawData.authorization === 'object' ? rawData.authorization as Record<string, unknown> : undefined;
    const mobileMoney = authorization?.mobile_money && typeof authorization.mobile_money === 'object' ? authorization.mobile_money as Record<string, unknown> : undefined;

    const providerReference =
      (typeof payment.provider_reference === 'string' && payment.provider_reference.trim())
        ? payment.provider_reference
        : webhook?.reference ??
          (typeof rawData.reference === 'string' ? rawData.reference : null) ??
          (typeof rawResponse.reference === 'string' ? rawResponse.reference : null) ??
          (typeof mobileMoney?.trans_id === 'string' ? mobileMoney.trans_id : null) ??
          null;

    const paidAt =
      (typeof payment.paid_at === 'string' && payment.paid_at.trim())
        ? payment.paid_at
        : (typeof webhook?.completed_at === 'string' && webhook.completed_at.trim())
          ? webhook.completed_at
          : (typeof webhook?.created_at === 'string' && webhook.created_at.trim())
            ? webhook.created_at
            : (typeof rawResponse.completed_at === 'string' ? rawResponse.completed_at : null);

    fixPayment.run({
      id: payment.id,
      provider_reference: providerReference,
      paid_at: paidAt,
      updated_at: payment.updated_at ?? null,
    });
  }

  for (const order of orders) {
    const payment = paymentByOrderId.get(String(order.id ?? '').trim()) ?? paymentByReference.get(String(order.payment_reference ?? '').trim()) ?? undefined;
    const escrow = escrowByOrderId.get(String(order.id ?? '').trim());
    const releaseTimestamp = extractReleaseTimestamp(escrow);
    const webhook = payment ? (webhookByTxRef.get(String(payment.reference ?? '').trim()) ?? webhookByReference.get(String(payment.reference ?? '').trim())) : undefined;

    const paidAt =
      (typeof order.paid_at === 'string' && order.paid_at.trim())
        ? order.paid_at
        : payment?.paid_at ?? webhook?.completed_at ?? webhook?.created_at ?? null;

    const fulfilledAt =
      (typeof order.fulfilled_at === 'string' && order.fulfilled_at.trim())
        ? order.fulfilled_at
        : releaseTimestamp ?? (String(order.status ?? '').trim().toLowerCase() === 'fulfilled' ? order.updated_at ?? null : null);

    fixOrder.run({
      id: order.id,
      payment_reference: payment?.reference ?? order.payment_reference ?? null,
      paid_at: paidAt,
      fulfilled_at: fulfilledAt,
      escrow_id: escrow?.id ?? order.escrow_id ?? null,
      updated_at: order.updated_at ?? null,
    });
  }
}

function main() {
  const sqlitePath = getEnv('SQLITE_DB_PATH') ?? getEnv('BACKFILL_SQLITE_PATH') ?? getEnv('LEGACY_SQLITE_DB_PATH');
  if (!sqlitePath) {
    throw new Error('Set SQLITE_DB_PATH to the legacy SQLite database file you want to backfill from.');
  }

  const resolvedSqlitePath = resolve(sqlitePath);
  if (!existsSync(resolvedSqlitePath)) {
    throw new Error(`SQLite database not found at ${resolvedSqlitePath}`);
  }

  const sqliteBinary = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
  if (sqliteBinary.status !== 0) {
    throw new Error('sqlite3 CLI is required to run this backfill script. Install it or export the legacy database to JSON first.');
  }

  const dryRun = ['1', 'true', 'yes', 'on'].includes(String(process.env.DRY_RUN ?? '').trim().toLowerCase());
  const requestedTables = (getEnv('BACKFILL_TABLES') ?? '').split(',').map((value) => value.trim()).filter(Boolean) as TableName[];
  const tables = requestedTables.length > 0 ? requestedTables : DEFAULT_TABLES;

  const db = getPaymentDb();
  const summaries: RepairStats[] = [];

  for (const table of tables) {
    if (!tableExistsSqlite(resolvedSqlitePath, table)) {
      console.log(`Skipping missing SQLite table: ${table}`);
      continue;
    }

    const sqliteRowsRaw = loadSqliteRows(resolvedSqlitePath, table);
    const sqliteRows = normalizeSourceRows(table, sqliteRowsRaw);
    const postgresRowsBefore = countPostgresRows(table);

    const result = dryRun
      ? { imported: 0, updated: 0, skipped: sqliteRows.length }
      : upsertRows(table, sqliteRows);

    const postgresRowsAfter = countPostgresRows(table);
    summaries.push({
      table,
      sqliteRows: sqliteRows.length,
      postgresRowsBefore,
      postgresRowsAfter,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
    });
  }

  if (!dryRun) {
    repairPgLinks();
  }

  console.log('');
  console.log(dryRun ? 'Dry run summary' : 'Backfill summary');
  for (const summary of summaries) {
    console.log(
      `${summary.table}: sqlite=${summary.sqliteRows}, pg_before=${summary.postgresRowsBefore}, pg_after=${summary.postgresRowsAfter}, imported=${summary.imported}, updated=${summary.updated}, skipped=${summary.skipped}`,
    );
  }

  if (!dryRun) {
    const repairedPayments = countPostgresRows('payments');
    const repairedOrders = countPostgresRows('orders');
    const repairedWebhooks = countPostgresRows('payment_webhook_events');
    const repairedPayouts = countPostgresRows('payouts');

    console.log('');
    console.log('Post-repair counts');
    console.log(`payments=${repairedPayments}, orders=${repairedOrders}, payment_webhook_events=${repairedWebhooks}, payouts=${repairedPayouts}`);
  }

  void db;
}

try {
  main();
} catch (error) {
  console.error('Finance backfill failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}