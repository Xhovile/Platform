import { getPaymentDb } from '../../postgresCompat.js';

const db = getPaymentDb();

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`).all(tableName) as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureIndex(statement: string): void {
  db.exec(statement);
}

function backfillMissingPayoutDestinations(): void {
  const payoutRows = db.prepare(
    `SELECT id, seller_id AS sellerId
     FROM payouts
     WHERE destination_account_id IS NULL
       AND seller_id IS NOT NULL
       AND (order_id IS NOT NULL OR escrow_id IS NOT NULL)`,
  ).all() as Array<{ id: string; sellerId: string }>;

  if (payoutRows.length === 0) {
    return;
  }

  const verifiedDestinationStmt = db.prepare(
    `SELECT id
     FROM seller_payout_accounts
     WHERE seller_uid = ?
       AND is_active = 1
       AND verification_status = 'verified'
     ORDER BY is_default DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
  );

  const updatePayoutDestinationStmt = db.prepare(
    `UPDATE payouts
     SET destination_account_id = ?,
         updated_at = ?
     WHERE id = ?
       AND destination_account_id IS NULL`,
  );

  const insertBackfillEventStmt = db.prepare(
    `INSERT INTO payout_events (
      payout_id,
      seller_id,
      event_type,
      actor_type,
      actor_id,
      note,
      payload,
      created_at
    ) VALUES (?, ?, ?, 'system', ?, ?, ?, ?)`,
  );

  for (const payout of payoutRows) {
    const destination = verifiedDestinationStmt.get(payout.sellerId) as { id: string } | undefined;
    if (!destination) {
      continue;
    }

    const now = new Date().toISOString();
    const result = updatePayoutDestinationStmt.run(destination.id, now, payout.id) as { changes?: number };

    if (Number(result.changes ?? 0) > 0) {
      insertBackfillEventStmt.run(
        payout.id,
        payout.sellerId,
        'payout_destination_backfilled',
        null,
        'Backfilled missing destination_account_id from the seller\'s current verified destination',
        JSON.stringify({
          previousDestinationAccountId: null,
          nextDestinationAccountId: destination.id,
          backfilledAt: now,
        }),
        now,
      );
    }
  }
}

function ensurePayoutLifecycleSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payout_attempts (
      id TEXT PRIMARY KEY,
      payout_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_charge_id TEXT NOT NULL UNIQUE,
      request_payload TEXT NOT NULL,
      response_payload TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      failure_reason TEXT,
      sent_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payout_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      note TEXT,
      payload TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payout_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payout_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      provider_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE CASCADE,
      FOREIGN KEY (seller_id) REFERENCES sellers(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS seller_payout_account_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_uid TEXT NOT NULL,
      account_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      note TEXT,
      payload TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES seller_payout_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (seller_uid) REFERENCES sellers(uid) ON DELETE CASCADE
    );
  `);

  ensureColumn('payouts', 'destination_account_id', 'TEXT');
  ensureColumn('payouts', 'provider_ref_id', 'TEXT');
  ensureColumn('payouts', 'provider_transaction_id', 'TEXT');
  ensureColumn('payouts', 'provider_status', 'TEXT');
  ensureColumn('payouts', 'failure_reason', 'TEXT');
  ensureColumn('payouts', 'manual_review_reason', 'TEXT');
  ensureColumn('payouts', 'approved_by', 'TEXT');
  ensureColumn('payouts', 'sent_at', 'TIMESTAMPTZ');
  ensureColumn('payouts', 'paid_at', 'TIMESTAMPTZ');
  ensureColumn('payouts', 'failed_at', 'TIMESTAMPTZ');
  ensureColumn('payouts', 'last_attempt_id', 'TEXT');
  ensureColumn('payouts', 'raw_request', 'TEXT');
  ensureColumn('payouts', 'raw_response', 'TEXT');
  ensureColumn('payouts', 'processed_by', 'TEXT');
  ensureColumn('payouts', 'gross_amount', 'INTEGER');
  ensureColumn('payouts', 'platform_fee_amount', 'INTEGER');
  ensureColumn('payouts', 'processing_fee_amount', 'INTEGER');
  ensureColumn('payouts', 'reserve_amount', 'INTEGER');
  ensureColumn('payouts', 'reserve_cap_amount', 'INTEGER');
  ensureColumn('payouts', 'manual_adjustment_amount', 'INTEGER');
  ensureColumn('payouts', 'payout_fee_amount', 'INTEGER');
  ensureColumn('payouts', 'seller_receives_amount', 'INTEGER');
  ensureColumn('payouts', 'net_amount', 'INTEGER');
  ensureColumn('payouts', 'formula_snapshot', 'TEXT');
  ensureColumn('payouts', 'last_adjustment_id', 'TEXT');
  ensureColumn('sellers', 'is_suspended', 'INTEGER NOT NULL DEFAULT 0');

  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payout_attempts_payout_id ON payout_attempts (payout_id, created_at DESC)`);
  ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_attempts_payout_id_attempt_no ON payout_attempts (payout_id, attempt_no)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payout_attempts_status ON payout_attempts (status, created_at DESC)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payout_events_payout_id ON payout_events (payout_id, created_at DESC)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payout_events_seller_id ON payout_events (seller_id, created_at DESC)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payout_adjustments_payout_id ON payout_adjustments (payout_id, created_at DESC)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payout_adjustments_seller_id ON payout_adjustments (seller_id, created_at DESC)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_seller_payout_account_events_seller_uid ON seller_payout_account_events (seller_uid, created_at DESC)`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payouts_destination_account_id ON payouts (destination_account_id)`);
  ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_release_entry_unique ON payouts (release_entry_id) WHERE release_entry_id IS NOT NULL`);
  ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_connect_order_unique ON payouts (order_id) WHERE order_id IS NOT NULL AND escrow_id IS NULL`);
  ensureIndex(`CREATE INDEX IF NOT EXISTS idx_payouts_escrow_id ON payouts (escrow_id)`);

  db.exec(`DROP TRIGGER IF EXISTS trg_prevent_payout_double_processing ON payouts;`);
  db.exec(`DROP FUNCTION IF EXISTS prevent_payout_double_processing();`);
  db.exec(`
    CREATE FUNCTION prevent_payout_double_processing()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.status = 'processing' AND NEW.status = 'processing' THEN
        RAISE EXCEPTION 'Payout is already processing';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  db.exec(`
    CREATE TRIGGER trg_prevent_payout_double_processing
    BEFORE UPDATE ON payouts
    FOR EACH ROW
    EXECUTE FUNCTION prevent_payout_double_processing();
  `);

  db.exec(`DROP TRIGGER IF EXISTS trg_preserve_verified_seller_payout_destination ON seller_payout_accounts;`);
  db.exec(`DROP FUNCTION IF EXISTS preserve_verified_seller_payout_destination();`);
  db.exec(`
    CREATE FUNCTION preserve_verified_seller_payout_destination()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF OLD.verification_status = 'verified'
        AND NEW.verification_status = 'pending'
        AND COALESCE(OLD.destination_fingerprint, '') = COALESCE(NEW.destination_fingerprint, '')
        AND COALESCE(OLD.destination_type, '') = COALESCE(NEW.destination_type, '')
        AND COALESCE(OLD.provider_name, '') = COALESCE(NEW.provider_name, '')
        AND COALESCE(OLD.provider_ref_id, '') = COALESCE(NEW.provider_ref_id, '')
        AND COALESCE(OLD.currency, '') = COALESCE(NEW.currency, '')
        AND OLD.is_active = 1
        AND NEW.is_active = 1
      THEN
        NEW.verification_status := 'verified';
        NEW.verification_attempts := OLD.verification_attempts;
        NEW.last_error := OLD.last_error;
        NEW.verified_at := OLD.verified_at;
        NEW.updated_at := CURRENT_TIMESTAMP;
      END IF;

      RETURN NEW;
    END;
    $$;
  `);
  db.exec(`
    CREATE TRIGGER trg_preserve_verified_seller_payout_destination
    BEFORE UPDATE ON seller_payout_accounts
    FOR EACH ROW
    EXECUTE FUNCTION preserve_verified_seller_payout_destination();
  `);

  backfillMissingPayoutDestinations();
}

export { ensurePayoutLifecycleSchema };