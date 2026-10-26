export interface PayChanguCardSchemaDatabase {
  exec(sql: string): unknown;
}

/** Create only the Direct Card Charge tracking table; does not connect to an application database. */
export function ensurePayChanguCardChargeSchema(db: PayChanguCardSchemaDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS paychangu_card_charges (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      payment_reference TEXT NOT NULL UNIQUE,
      charge_id TEXT NOT NULL UNIQUE,
      amount NUMERIC NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL CHECK (currency IN ('MWK', 'USD')),
      status TEXT NOT NULL DEFAULT 'pending',
      requires_3ds_auth INTEGER NOT NULL DEFAULT 0,
      authorization_completed INTEGER NOT NULL DEFAULT 0,
      three_ds_auth_url TEXT,
      result_url TEXT NOT NULL,
      provider_order_reference TEXT,
      last_provider_status TEXT,
      failure_reason TEXT,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_paychangu_card_charges_order_created
      ON paychangu_card_charges (order_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_paychangu_card_charges_status_updated
      ON paychangu_card_charges (status, updated_at DESC);
  `);

  db.exec("ALTER TABLE paychangu_card_charges ADD COLUMN IF NOT EXISTS authorization_completed INTEGER NOT NULL DEFAULT 0");

}
