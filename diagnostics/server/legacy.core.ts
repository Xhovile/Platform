import type { Express } from "express";
import { getFirebaseAdmin } from "../auth/firebaseAdmin.js";
import { query } from "../postgres.js";
import { PAYMENT_ENDPOINTS } from "../modules/payments/payment.endpoints.js";
import { paymentWebhookHandler } from "../modules/payments/payment.webhooks.js";
import { payoutWebhookHandler } from "../modules/payouts/payout.webhooks.js";

type CheckStatus = "PASS" | "WARN" | "FAIL";
type NamedCheck = {
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
};
type ColumnRow = { table_name: string; column_name: string };
type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

const REQUIRED_TABLES = [
  "sellers",
  "listings",
  "payments",
  "orders",
  "seller_applications",
  "listing_reviews",
  "reports",
  "buyer_cart_items",
  "conversations",
  "messages",
  "admin_actions",
  "escrows",
  "escrow_events",
  "disputes",
  "payouts",
  "payment_webhook_events",
  "seller_payout_accounts",
  "payout_attempts",
  "payout_events",
  "payout_adjustments",
  "seller_payout_account_events",
  "idempotency_keys",
] as const;

const REQUIRED_COLUMNS: Record<string, string[]> = {
  listings: ["seller_uid", "name", "price", "status", "quantity", "sold_quantity", "category", "university", "deleted_at", "deleted_by_uid", "hard_delete_after"],
  payments: ["order_id", "provider", "method", "status", "reference", "currency", "amount"],
  orders: ["id", "buyer_id", "seller_id", "source", "status", "currency", "subtotal_amount", "total_amount"],
  seller_applications: ["applicant_uid", "applicant_email", "full_legal_name", "institution", "applicant_type", "institution_id_number", "business_name", "what_to_sell", "business_description", "reason_for_applying", "proof_document_url", "status"],
  payment_webhook_events: ["provider", "reference", "event_type", "signature_valid", "payload", "created_at"],
  payouts: ["seller_id", "order_id", "escrow_id", "status", "currency", "amount", "destination_account_id", "provider_ref_id", "provider_transaction_id", "provider_status", "failure_reason", "manual_review_reason", "approved_by", "sent_at", "paid_at", "failed_at", "gross_amount", "platform_fee_amount", "processing_fee_amount", "reserve_amount", "reserve_cap_amount", "manual_adjustment_amount", "payout_fee_amount", "seller_receives_amount", "net_amount", "formula_snapshot", "last_adjustment_id", "processed_by", "raw_request", "raw_response"],
  seller_payout_accounts: ["seller_uid", "destination_type", "provider_name", "masked_account", "destination_fingerprint", "is_default", "verification_status", "is_active", "created_at", "updated_at"],
  payout_attempts: ["payout_id", "attempt_no", "provider", "provider_charge_id", "request_payload", "status", "created_at", "updated_at"],
  payout_events: ["payout_id", "seller_id", "event_type", "actor_type", "created_at"],
  payout_adjustments: ["payout_id", "seller_id", "adjustment_type", "amount", "currency", "reason", "actor_type", "created_at"],
  seller_payout_account_events: ["seller_uid", "account_id", "event_type", "actor_type", "created_at"],
};

const REQUIRED_PAYMENT_ENDPOINTS = {
  initialize: "/api/payments/paychangu/initialize",
  verify: "/api/payments/paychangu/verify/:txRef",
  webhook: "/api/payments/paychangu/webhook",
  payoutWebhook: "/api/payments/paychangu-payout/webhook",
} as const;

function statusWeight(status: CheckStatus): number {
  return status === "FAIL" ? 2 : status === "WARN" ? 1 : 0;
}

function combineStatus(checks: NamedCheck[]): CheckStatus {
  const worst = checks.reduce((max, check) => Math.max(max, statusWeight(check.status)), 0);
  return worst === 2 ? "FAIL" : worst === 1 ? "WARN" : "PASS";
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function checkDatabase(): Promise<NamedCheck> {
  const started = Date.now();
  try {
    const result = await query<{ ok: number }>("SELECT 1 AS ok");
    const ok = result.rows[0]?.ok === 1;
    return {
      status: ok ? "PASS" : "FAIL",
      message: ok ? "Direct PostgreSQL query succeeded" : "Database returned an unexpected result",
      details: { latency_ms: Date.now() - started, row_count: result.rowCount },
    };
  } catch (error) {
    return {
      status: "FAIL",
      message: `Direct PostgreSQL query failed: ${error instanceof Error ? error.message : String(error)}`,
      details: { latency_ms: Date.now() - started },
    };
  }
}

async function getTableNames(): Promise<Set<string>> {
  const result = await query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function getColumnMap(): Promise<Map<string, Set<string>>> {
  const result = await query<ColumnRow>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()",
  );
  const map = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const set = map.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    map.set(row.table_name, set);
  }
  return map;
}

function checkTables(tableNames: Set<string>): NamedCheck {
  const missing = REQUIRED_TABLES.filter((table) => !tableNames.has(table));
  return {
    status: missing.length ? "FAIL" : "PASS",
    message: missing.length ? `Missing tables: ${missing.join(", ")}` : "All required tables are present",
    details: { required_tables: REQUIRED_TABLES.length, missing_tables: missing },
  };
}

function checkColumns(columnMap: Map<string, Set<string>>, tableNames: Set<string>): NamedCheck {
  const missingByTable: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!tableNames.has(table)) {
      missingByTable[table] = [...columns];
      continue;
    }
    const present = columnMap.get(table) ?? new Set<string>();
    const missing = columns.filter((column) => !present.has(column));
    if (missing.length) missingByTable[table] = missing;
  }
  return {
    status: Object.keys(missingByTable).length ? "FAIL" : "PASS",
    message: Object.keys(missingByTable).length ? "Required columns are missing" : "Required columns are present",
    details: { checked_tables: Object.keys(REQUIRED_COLUMNS), missing_columns: missingByTable },
  };
}

async function checkRowCounts(tableNames: Set<string>): Promise<NamedCheck> {
  const counts: Record<string, number> = {};
  const failures: Record<string, string> = {};

  for (const table of REQUIRED_TABLES) {
    if (!tableNames.has(table)) {
      failures[table] = "table missing";
      continue;
    }
    try {
      const result = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)}`);
      const count = Number(result.rows[0]?.count);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid row count returned");
      counts[table] = count;
    } catch (error) {
      failures[table] = error instanceof Error ? error.message : String(error);
    }
  }

  const status = Object.keys(failures).length ? "FAIL" : "PASS";
  return {
    status,
    message: status === "PASS" ? "Exact row counts collected for every required table" : "One or more table counts could not be verified",
    details: { counts, failures },
  };
}

async function checkForeignKeys(tableNames: Set<string>): Promise<NamedCheck> {
  try {
    const result = await query<ForeignKeyRow>(
      `SELECT tc.constraint_name, tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = current_schema()
       ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
    );

    const orphaned: Array<Record<string, unknown>> = [];
    for (const fk of result.rows) {
      if (!tableNames.has(fk.table_name) || !tableNames.has(fk.foreign_table_name)) continue;
      const childTable = quoteIdent(fk.table_name);
      const childColumn = quoteIdent(fk.column_name);
      const parentTable = quoteIdent(fk.foreign_table_name);
      const parentColumn = quoteIdent(fk.foreign_column_name);
      const orphanResult = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM ${childTable} child
         LEFT JOIN ${parentTable} parent
           ON child.${childColumn} = parent.${parentColumn}
         WHERE child.${childColumn} IS NOT NULL
           AND parent.${parentColumn} IS NULL`,
      );
      const orphanCount = Number(orphanResult.rows[0]?.count);
      if (!Number.isSafeInteger(orphanCount) || orphanCount < 0) {
        throw new Error(`invalid orphan count for ${fk.constraint_name}`);
      }
      if (orphanCount > 0) {
        orphaned.push({
          constraint: fk.constraint_name,
          table: fk.table_name,
          column: fk.column_name,
          references: `${fk.foreign_table_name}.${fk.foreign_column_name}`,
          orphan_count: orphanCount,
        });
      }
    }

    return {
      status: orphaned.length ? "FAIL" : "PASS",
      message: orphaned.length ? "Foreign-key integrity violations detected" : "No orphaned foreign-key records found",
      details: { constraints_checked: result.rows.length, orphaned },
    };
  } catch (error) {
    return {
      status: "FAIL",
      message: `Foreign-key integrity check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkDatabaseIdentity(): Promise<NamedCheck> {
  try {
    const result = await query<{
      database_name: string;
      schema_name: string;
      server_version: string;
      checked_at: string;
      ssl: boolean;
    }>(
      `SELECT current_database() AS database_name,
              current_schema() AS schema_name,
              current_setting('server_version') AS server_version,
              NOW()::text AS checked_at,
              COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl`,
    );
    const row = result.rows[0];
    if (!row) return { status: "FAIL", message: "Database identity query returned no row" };
    return {
      status: row.ssl ? "PASS" : "WARN",
      message: row.ssl ? "Connected directly to PostgreSQL over SSL" : "Connected to PostgreSQL without SSL",
      details: row,
    };
  } catch (error) {
    return { status: "FAIL", message: `Database identity check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function checkCriticalDataConsistency(tableNames: Set<string>, columnMap: Map<string, Set<string>>): Promise<NamedCheck> {
  const problems: Record<string, number> = {};
  const canCheck = (table: string, ...columns: string[]) => tableNames.has(table) && columns.every((column) => columnMap.get(table)?.has(column));

  try {
    if (canCheck("orders", "buyer_id")) {
      const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM orders WHERE buyer_id IS NULL OR BTRIM(buyer_id::text) = ''");
      problems.orders_missing_buyer_id = Number(result.rows[0]?.count ?? 0);
    }
    if (canCheck("orders", "seller_id")) {
      const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM orders WHERE seller_id IS NULL OR BTRIM(seller_id::text) = ''");
      problems.orders_missing_seller_id = Number(result.rows[0]?.count ?? 0);
    }
    if (canCheck("listings", "seller_uid")) {
      const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM listings WHERE seller_uid IS NULL OR BTRIM(seller_uid::text) = ''");
      problems.listings_missing_seller_uid = Number(result.rows[0]?.count ?? 0);
    }
    if (canCheck("payments", "order_id")) {
      const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM payments WHERE order_id IS NULL OR BTRIM(order_id::text) = ''");
      problems.payments_missing_order_id = Number(result.rows[0]?.count ?? 0);
    }

    const invalid = Object.entries(problems).filter(([, value]) => !Number.isSafeInteger(value) || value < 0 || value > 0);
    return {
      status: invalid.length ? "FAIL" : "PASS",
      message: invalid.length ? "Critical business records contain missing or invalid identifiers" : "Critical business records have required identifiers",
      details: problems,
    };
  } catch (error) {
    return { status: "FAIL", message: `Critical data consistency check failed: ${error instanceof Error ? error.message : String(error)}`, details: problems };
  }
}


async function checkBusinessInvariants(
  tableNames: Set<string>,
  columnMap: Map<string, Set<string>>,
): Promise<NamedCheck> {
  const checks: Record<
    string,
    {
      status: CheckStatus;
      count: number;
      message: string;
      details?: Record<string, unknown>;
    }
  > = {};

  const canCheck = (table: string, ...columns: string[]) =>
    tableNames.has(table) && columns.every((column) => columnMap.get(table)?.has(column));

  const record = (name: string, count: number, message: string, status: CheckStatus = count > 0 ? "FAIL" : "PASS") => {
    checks[name] = { status, count, message };
  };

  try {
    // 1. Order ↔ payment consistency.
    if (canCheck("payments", "order_id") && canCheck("orders", "id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payments p
        LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.order_id IS NOT NULL AND o.id IS NULL
      `);
      record("order_payment_orphans", Number(result.rows[0]?.count ?? 0), "Payments referencing missing orders");
    }

    if (canCheck("payments", "order_id", "reference") && canCheck("orders", "id", "payment_reference")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        WHERE o.payment_reference IS NOT NULL
          AND BTRIM(o.payment_reference::text) <> ''
          AND o.payment_reference <> p.reference
      `);
      record("order_payment_reference_mismatch", Number(result.rows[0]?.count ?? 0), "Orders and their stored payments disagree on payment reference");
    }

    if (canCheck("payments", "order_id", "status") && canCheck("orders", "id", "status", "total_amount")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM (
          SELECT o.id
          FROM orders o
          JOIN payments p ON p.order_id = o.id
          WHERE p.status = 'captured'
          GROUP BY o.id, o.total_amount
          HAVING ABS(COALESCE(SUM(p.amount), 0) - COALESCE(MAX(o.total_amount), 0)) > 0
        ) mismatches
      `);
      record("captured_payment_total_mismatch", Number(result.rows[0]?.count ?? 0), "Captured payment totals do not reconcile to order totals");
    }

    // 2. Payment ↔ escrow consistency.
    if (canCheck("orders", "id", "escrow_id") && canCheck("escrows", "id", "order_id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM orders o
        LEFT JOIN escrows e ON e.id = o.escrow_id
        WHERE o.escrow_id IS NOT NULL
          AND e.id IS NULL
      `);
      record("order_escrow_orphans", Number(result.rows[0]?.count ?? 0), "Orders reference missing escrows");
    }

    if (canCheck("escrows", "id", "order_id") && canCheck("orders", "id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM escrows e
        LEFT JOIN orders o ON o.id = e.order_id
        WHERE o.id IS NULL
      `);
      record("escrow_order_orphans", Number(result.rows[0]?.count ?? 0), "Escrows reference missing orders");
    }

    if (canCheck("orders", "id", "escrow_id", "status") && canCheck("escrows", "id", "order_id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM orders o
        JOIN escrows e ON e.id = o.escrow_id
        WHERE o.status IN ('in_escrow', 'fulfilled', 'disputed', 'refunded', 'closed')
          AND e.order_id <> o.id
      `);
      record("order_escrow_order_id_mismatch", Number(result.rows[0]?.count ?? 0), "Order escrow linkage is inconsistent");
    }

    // 3. Escrow ↔ payout consistency.
    if (canCheck("payouts", "escrow_id", "order_id") && canCheck("escrows", "id", "order_id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payouts p
        JOIN escrows e ON e.id = p.escrow_id
        WHERE p.escrow_id IS NOT NULL
          AND p.order_id IS NOT NULL
          AND p.order_id <> e.order_id
      `);
      record("payout_escrow_order_mismatch", Number(result.rows[0]?.count ?? 0), "Payout order and escrow order do not match");
    }

    if (canCheck("payouts", "escrow_id") && canCheck("escrows", "id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payouts p
        LEFT JOIN escrows e ON e.id = p.escrow_id
        WHERE p.escrow_id IS NOT NULL
          AND e.id IS NULL
      `);
      record("payout_escrow_orphans", Number(result.rows[0]?.count ?? 0), "Payouts reference missing escrows");
    }

    if (canCheck("payouts", "order_id") && canCheck("orders", "id")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payouts p
        LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.order_id IS NOT NULL
          AND o.id IS NULL
      `);
      record("payout_order_orphans", Number(result.rows[0]?.count ?? 0), "Payouts reference missing orders");
    }

    // 4. Payout amount calculations.
    if (
      canCheck(
        "payouts",
        "gross_amount",
        "platform_fee_amount",
        "processing_fee_amount",
        "reserve_amount",
        "manual_adjustment_amount",
        "payout_fee_amount",
        "seller_receives_amount",
        "net_amount",
      )
    ) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payouts
        WHERE ABS(
          COALESCE(seller_receives_amount, 0) -
          GREATEST(
            0,
            COALESCE(gross_amount, 0)
              - COALESCE(platform_fee_amount, 0)
              - COALESCE(processing_fee_amount, 0)
              - COALESCE(reserve_amount, 0)
              - COALESCE(manual_adjustment_amount, 0)
              - COALESCE(payout_fee_amount, 0)
          )
        ) > 0
        OR ABS(COALESCE(net_amount, 0) - COALESCE(seller_receives_amount, 0)) > 0
      `);
      record("payout_amount_formula_mismatches", Number(result.rows[0]?.count ?? 0), "Stored payout amounts do not reconcile to the payout formula");
    }

    // 5. Duplicate payment/reference/idempotency conditions.
    if (canCheck("payments", "reference")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM (
          SELECT reference
          FROM payments
          WHERE reference IS NOT NULL AND BTRIM(reference::text) <> ''
          GROUP BY reference
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      record("duplicate_payment_references", Number(result.rows[0]?.count ?? 0), "Duplicate payment references detected");
    }

    if (canCheck("payments", "provider", "provider_reference")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM (
          SELECT provider, provider_reference
          FROM payments
          WHERE provider_reference IS NOT NULL AND BTRIM(provider_reference::text) <> ''
          GROUP BY provider, provider_reference
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      record("duplicate_provider_references", Number(result.rows[0]?.count ?? 0), "Duplicate provider payment references detected");
    }

    if (canCheck("orders", "buyer_id", "checkout_idempotency_key")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM (
          SELECT buyer_id, checkout_idempotency_key
          FROM orders
          WHERE checkout_idempotency_key IS NOT NULL
            AND BTRIM(checkout_idempotency_key::text) <> ''
          GROUP BY buyer_id, checkout_idempotency_key
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      record("duplicate_checkout_idempotency_keys", Number(result.rows[0]?.count ?? 0), "Duplicate buyer checkout idempotency keys detected");
    }

    if (canCheck("payment_webhook_events", "provider", "reference", "event_type")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM (
          SELECT provider, reference, event_type
          FROM payment_webhook_events
          WHERE reference IS NOT NULL AND BTRIM(reference::text) <> ''
          GROUP BY provider, reference, event_type
          HAVING COUNT(*) > 1
        ) duplicates
      `);
      record("duplicate_payment_webhook_events", Number(result.rows[0]?.count ?? 0), "Duplicate payment webhook event identities detected");
    }

    // 6. Status-transition validity at the current-state level.
    if (canCheck("orders", "status")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM orders
        WHERE status NOT IN ('draft','pending_payment','paid','in_escrow','fulfilled','cancelled','refunded','disputed','closed')
      `);
      record("orders_invalid_status", Number(result.rows[0]?.count ?? 0), "Orders contain unknown lifecycle states");
    }

    if (canCheck("orders", "status", "paid_at", "fulfilled_at")) {
      const result = await query<{
        paid_missing_paid_at: string;
        in_escrow_missing_paid_at: string;
        fulfilled_missing_paid_at: string;
        fulfilled_missing_fulfilled_at: string;
        fulfilled_at_without_paid_at: string;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'paid' AND paid_at IS NULL)::text AS paid_missing_paid_at,
          COUNT(*) FILTER (WHERE status = 'in_escrow' AND paid_at IS NULL)::text AS in_escrow_missing_paid_at,
          COUNT(*) FILTER (WHERE status = 'fulfilled' AND paid_at IS NULL)::text AS fulfilled_missing_paid_at,
          COUNT(*) FILTER (WHERE status = 'fulfilled' AND fulfilled_at IS NULL)::text AS fulfilled_missing_fulfilled_at,
          COUNT(*) FILTER (WHERE fulfilled_at IS NOT NULL AND paid_at IS NULL)::text AS fulfilled_at_without_paid_at
        FROM orders
      `);
      const row = result.rows[0] ?? {
        paid_missing_paid_at: "0",
        in_escrow_missing_paid_at: "0",
        fulfilled_missing_paid_at: "0",
        fulfilled_missing_fulfilled_at: "0",
        fulfilled_at_without_paid_at: "0",
      };
      const details = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]),
      ) as Record<string, number>;
      const violationCount = Object.values(details).reduce((sum, value) => sum + value, 0);

      checks.order_status_timestamp_inconsistencies = {
        status: violationCount > 0 ? "FAIL" : "PASS",
        count: violationCount,
        message: violationCount > 0
          ? "Order lifecycle timestamp inconsistencies detected"
          : "Order lifecycle timestamps are consistent for enforced states",
      };
      checks.order_status_timestamp_details = {
        status: "PASS",
        count: violationCount,
        message: "Detailed order lifecycle timestamp breakdown",
        details,
      };
    }

    if (canCheck("escrows", "state")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM escrows
        WHERE state NOT IN ('initiated','funded','held','released','refunded','disputed','closed')
      `);
      record("escrows_invalid_state", Number(result.rows[0]?.count ?? 0), "Escrows contain unknown lifecycle states");
    }

    if (canCheck("escrows", "state", "balance_amount", "entries")) {
      const result = await query<{
        released_balance_nonzero: string;
        refunded_balance_nonzero: string;
        released_missing_entry: string;
        refunded_missing_entry: string;
        terminal_conflict: string;
      }>(`
        SELECT
          COUNT(*) FILTER (
            WHERE state = 'released' AND COALESCE(balance_amount, 0) <> 0
          )::text AS released_balance_nonzero,
          COUNT(*) FILTER (
            WHERE state = 'refunded' AND COALESCE(balance_amount, 0) <> 0
          )::text AS refunded_balance_nonzero,
          COUNT(*) FILTER (
            WHERE state = 'released'
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(entries::jsonb, '[]'::jsonb)) entry
                WHERE entry->>'entryType' = 'release'
              )
          )::text AS released_missing_entry,
          COUNT(*) FILTER (
            WHERE state = 'refunded'
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(entries::jsonb, '[]'::jsonb)) entry
                WHERE entry->>'entryType' = 'refund'
              )
          )::text AS refunded_missing_entry,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(entries::jsonb, '[]'::jsonb)) entry
              WHERE entry->>'entryType' = 'release'
            )
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(entries::jsonb, '[]'::jsonb)) entry
              WHERE entry->>'entryType' = 'refund'
            )
          )::text AS terminal_conflict
        FROM escrows
      `);
      const row = result.rows[0] ?? {
        released_balance_nonzero: "0",
        refunded_balance_nonzero: "0",
        released_missing_entry: "0",
        refunded_missing_entry: "0",
        terminal_conflict: "0",
      };
      record("escrow_released_balance_nonzero", Number(row.released_balance_nonzero ?? 0), "Released escrows have non-zero balances");
      record("escrow_refunded_balance_nonzero", Number(row.refunded_balance_nonzero ?? 0), "Refunded escrows have non-zero balances");
      record("escrow_released_missing_entry", Number(row.released_missing_entry ?? 0), "Released escrows are missing release ledger entries");
      record("escrow_refunded_missing_entry", Number(row.refunded_missing_entry ?? 0), "Refunded escrows are missing refund ledger entries");
      record("escrow_terminal_release_refund_conflict", Number(row.terminal_conflict ?? 0), "Escrows contain both release and refund terminal entries");
    }

    if (canCheck("payouts", "status")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payouts
        WHERE status NOT IN ('eligible','pending_settlement','ready_for_payout','queued','processing','pending','held','paid','failed','cancelled')
      `);
      record("payouts_invalid_status", Number(result.rows[0]?.count ?? 0), "Payouts contain unknown lifecycle states");
    }

    if (canCheck("payouts", "status", "paid_at", "failed_at")) {
      const result = await query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM payouts
        WHERE (status = 'paid' AND paid_at IS NULL)
           OR (status = 'failed' AND failed_at IS NULL)
           OR (status = 'paid' AND failed_at IS NOT NULL)
      `);
      record("payout_status_timestamp_inconsistencies", Number(result.rows[0]?.count ?? 0), "Payout status and lifecycle timestamps are inconsistent");
    }

    const failed = Object.values(checks).filter((check) => check.status === "FAIL");
    return {
      status: failed.length ? "FAIL" : "PASS",
      message: failed.length ? "Business-level integrity violations detected" : "Business-level integrity checks passed",
      details: checks,
    };
  } catch (error) {
    return {
      status: "FAIL",
      message: `Business invariant checks failed: ${error instanceof Error ? error.message : String(error)}`,
      details: checks,
    };
  }
}

async function checkHardDeleteColumn(columnMap: Map<string, Set<string>>, tableNames: Set<string>): Promise<NamedCheck> {
  if (!tableNames.has("listings")) return { status: "FAIL", message: "listings table is missing" };
  if (!columnMap.get("listings")?.has("hard_delete_after")) return { status: "FAIL", message: "hard_delete_after column is missing" };
  try {
    const result = await query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'listings' AND column_name = 'hard_delete_after' LIMIT 1",
    );
    const dataType = result.rows[0]?.data_type;
    if (!dataType) return { status: "FAIL", message: "hard_delete_after data type could not be verified" };
    return {
      status: dataType === "timestamp with time zone" ? "PASS" : "WARN",
      message: dataType === "timestamp with time zone" ? "hard_delete_after is TIMESTAMPTZ" : `hard_delete_after is ${dataType}`,
      details: { data_type: dataType },
    };
  } catch (error) {
    return { status: "FAIL", message: `hard_delete_after check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function checkEnvironment(name: string, required = false): NamedCheck {
  const configured = Boolean(process.env[name]?.trim());
  return {
    status: configured ? "PASS" : required ? "FAIL" : "WARN",
    message: configured ? `${name} is configured` : `${name} is not configured`,
    details: { configured },
  };
}

function checkEnvironmentGroup(names: string[], label: string, mode: "all" | "any" = "all"): NamedCheck {
  const configured = names.filter((name) => Boolean(process.env[name]?.trim()));
  const complete = mode === "any" ? configured.length > 0 : configured.length === names.length;
  return {
    status: complete ? "PASS" : "WARN",
    message: complete ? `${label} is configured` : `${label} is partially or not configured`,
    details: { configured, missing: names.filter((name) => !configured.includes(name)) },
  };
}

function checkFirebaseAdmin(): NamedCheck {
  try {
    const admin = getFirebaseAdmin();
    return { status: "PASS", message: "Firebase Admin initialized", details: { apps: admin.apps.length } };
  } catch (error) {
    return { status: "FAIL", message: error instanceof Error ? error.message : String(error) };
  }
}

function checkWebhookExports(): NamedCheck {
  const paymentOk = typeof paymentWebhookHandler === "function" && typeof (paymentWebhookHandler as { handlePaychanguWebhook?: unknown }).handlePaychanguWebhook === "function";
  const payoutOk = typeof payoutWebhookHandler === "function" && typeof (payoutWebhookHandler as { handlePaychanguWebhook?: unknown }).handlePaychanguWebhook === "function";
  return {
    status: paymentOk && payoutOk ? "PASS" : "FAIL",
    message: paymentOk && payoutOk ? "Webhook handlers are exported" : "Webhook handler exports are missing",
    details: { paymentWebhookHandler: paymentOk, payoutWebhookHandler: payoutOk },
  };
}

function checkPaymentEndpointContract(): NamedCheck {
  const actual = PAYMENT_ENDPOINTS.paychangu as Record<string, string | undefined>;
  const mismatches: Record<string, { expected: string; actual: string | undefined }> = {};
  for (const [key, expected] of Object.entries(REQUIRED_PAYMENT_ENDPOINTS)) {
    if (actual[key] !== expected) mismatches[key] = { expected, actual: actual[key] };
  }
  return {
    status: Object.keys(mismatches).length ? "FAIL" : "PASS",
    message: Object.keys(mismatches).length ? "Payment endpoint contract mismatch" : "Payment endpoint contract matches",
    details: mismatches,
  };
}

type DiagnosticPayload = {
  overall: CheckStatus;
  authoritative: true;
  diagnostic_version: string;
  timestamp: string;
  duration_ms: number;
  checks?: Record<string, NamedCheck>;
  error?: string;
};

type DiagnosticRunResult = {
  statusCode: number;
  payload: DiagnosticPayload;
};

const DIAGNOSTIC_CACHE_MS = 30_000;
let diagnosticInFlight: Promise<DiagnosticRunResult> | null = null;
let diagnosticCache: { expiresAt: number; result: DiagnosticRunResult } | null = null;

async function runDiagnostics(): Promise<DiagnosticRunResult> {
  const started = Date.now();

  try {
    const database = await checkDatabase();

    if (database.status === "FAIL") {
      return {
        statusCode: 503,
        payload: {
          overall: "FAIL",
          authoritative: true,
        diagnostic_version: "2.0",
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - started,
          checks: {
            database,
            database_url: checkEnvironment("DATABASE_URL", true),
          },
        },
      };
    }

    const [tableNames, columnMap] = await Promise.all([getTableNames(), getColumnMap()]);
    const tables = checkTables(tableNames);
    const columns = checkColumns(columnMap, tableNames);
    const counts = await checkRowCounts(tableNames);
    const foreignKeys = await checkForeignKeys(tableNames);
    const criticalData = await checkCriticalDataConsistency(tableNames, columnMap);
    const businessInvariants = await checkBusinessInvariants(tableNames, columnMap);
    const databaseIdentity = await checkDatabaseIdentity();
    const hardDelete = await checkHardDeleteColumn(columnMap, tableNames);
    const paymentEndpoints = checkPaymentEndpointContract();
    const webhookExports = checkWebhookExports();

    const checks: Record<string, NamedCheck> = {
      database,
      database_identity: databaseIdentity,
      tables,
      columns,
      counts,
      foreign_keys: foreignKeys,
      critical_data: criticalData,
      business_invariants: businessInvariants,
      hard_delete_after: hardDelete,
      firebase: checkFirebaseAdmin(),
      cloudinary: checkEnvironmentGroup(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"], "Cloudinary"),
      smtp: checkEnvironmentGroup(["SMTP_HOST", "SMTP_USER", "SMTP_PASS"], "SMTP"),
      paychangu: checkEnvironmentGroup(["PAYCHANGU_SECRET_KEY", "PAYCHANGU_WEBHOOK_SECRET"], "PayChangu"),
      database_url: checkEnvironment("DATABASE_URL", true),
      admin_access: checkEnvironmentGroup(["ADMIN_EMAILS", "ADMIN_UIDS"], "Admin access", "any"),
      payments: {
        status: combineStatus([
          paymentEndpoints,
          webhookExports,
          tables,
          columns,
          counts,
          foreignKeys,
          criticalData,
          businessInvariants,
        ]),
        message: "Payment runtime and database integrity checks included above",
        details: { endpoint_contract: paymentEndpoints, webhook_exports: webhookExports },
      },
    };

    const overall = combineStatus(Object.values(checks));
    return {
      statusCode: overall === "FAIL" ? 503 : 200,
      payload: {
        overall,
        authoritative: true,
        diagnostic_version: "2.0",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - started,
        checks,
      },
    };
  } catch (error) {
    return {
      statusCode: 503,
      payload: {
        overall: "FAIL",
        authoritative: true,
        diagnostic_version: "2.0",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function registerDiagnosticsRoutes(app: Express, _deps: { db: any }) {
  app.get("/api/health", (_req, res) => {
    res.redirect("/api/diagnostics");
  });

  app.get("/api/diagnostics", async (_req, res) => {
    const now = Date.now();

    if (diagnosticCache && diagnosticCache.expiresAt > now) {
      res
        .status(diagnosticCache.result.statusCode)
        .setHeader("Cache-Control", "no-store")
        .setHeader("X-BuyMesho-Diagnostics-Cache", "HIT")
        .json(diagnosticCache.result.payload);
      return;
    }

    if (!diagnosticInFlight) {
      diagnosticInFlight = runDiagnostics()
        .then((result) => {
          const hasDatabaseFailure = result.payload.checks?.database?.status === "FAIL";
          if (!hasDatabaseFailure) {
            diagnosticCache = {
              expiresAt: Date.now() + DIAGNOSTIC_CACHE_MS,
              result,
            };
          }
          return result;
        })
        .finally(() => {
          diagnosticInFlight = null;
        });
    }

    try {
      const result = await diagnosticInFlight;
      res
        .status(result.statusCode)
        .setHeader("Cache-Control", "no-store")
        .setHeader("X-BuyMesho-Diagnostics-Cache", "MISS")
        .json(result.payload);
    } catch (error) {
      res
        .status(503)
        .setHeader("Cache-Control", "no-store")
        .json({
          overall: "FAIL",
          authoritative: true,
        diagnostic_version: "2.0",
          timestamp: new Date().toISOString(),
          duration_ms: 0,
          error: error instanceof Error ? error.message : String(error),
        } satisfies DiagnosticPayload);
    }
  });
}
