-- Payout lifecycle sync migration
-- Aligns the stored schema with the current payout and escrow lifecycle.

ALTER TABLE payouts ADD COLUMN gross_amount INTEGER;
ALTER TABLE payouts ADD COLUMN platform_fee_amount INTEGER;
ALTER TABLE payouts ADD COLUMN processing_fee_amount INTEGER;
ALTER TABLE payouts ADD COLUMN reserve_amount INTEGER;
ALTER TABLE payouts ADD COLUMN reserve_cap_amount INTEGER;
ALTER TABLE payouts ADD COLUMN manual_adjustment_amount INTEGER;
ALTER TABLE payouts ADD COLUMN net_amount INTEGER;
ALTER TABLE payouts ADD COLUMN formula_snapshot TEXT;
ALTER TABLE payouts ADD COLUMN last_adjustment_id TEXT;

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

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_payout_id
ON payout_adjustments (payout_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_seller_id
ON payout_adjustments (seller_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_attempts_payout_id_attempt_no
ON payout_attempts (payout_id, attempt_no);
