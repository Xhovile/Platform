import { getPaymentDb } from "../server/postgresCompat.js";

if (process.env.NODE_ENV !== "test") {
  console.error("Finance reset refused: this script may only run with NODE_ENV=test against the isolated test database.");
  process.exit(1);
}

const FINANCE_TABLES_IN_DELETE_ORDER = [
  "payout_attempts",
  "payout_events",
  "payout_adjustments",
  "seller_payout_account_events",
  "payouts",
  "escrows",
  "disputes",
  "payments",
  "orders",
  "seller_payout_accounts",
  "payment_webhook_events",
  "idempotency_keys",
] as const;

function main() {
  const db = getPaymentDb();

  const reset = db.transaction(() => {
    for (const table of FINANCE_TABLES_IN_DELETE_ORDER) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });

  reset();
  console.log("Finance data reset complete.");
}

try {
  main();
} catch (error) {
  console.error(
    "Finance reset failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
