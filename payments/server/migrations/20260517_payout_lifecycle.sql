-- Payout lifecycle migration
-- Apply once to align the database with seller payout execution.

ALTER TABLE payouts ADD COLUMN destination_account_id TEXT;
ALTER TABLE payouts ADD COLUMN provider_ref_id TEXT;
ALTER TABLE payouts ADD COLUMN provider_transaction_id TEXT;
ALTER TABLE payouts ADD COLUMN provider_status TEXT;
ALTER TABLE payouts ADD COLUMN failure_reason TEXT;
ALTER TABLE payouts ADD COLUMN manual_review_reason TEXT;
ALTER TABLE payouts ADD COLUMN approved_by TEXT;
ALTER TABLE payouts ADD COLUMN sent_at TIMESTAMPTZ;
ALTER TABLE payouts ADD COLUMN paid_at TIMESTAMPTZ;
ALTER TABLE payouts ADD COLUMN failed_at TIMESTAMPTZ;
ALTER TABLE payouts ADD COLUMN last_attempt_id TEXT;
ALTER TABLE payouts ADD COLUMN raw_request TEXT;
ALTER TABLE payouts ADD COLUMN raw_response TEXT;

CREATE INDEX IF NOT EXISTS idx_payouts_destination_account_id
ON payouts (destination_account_id);

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

CREATE INDEX IF NOT EXISTS idx_payout_attempts_payout_id
ON payout_attempts (payout_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_attempts_status
ON payout_attempts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS seller_payout_account_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_payout_events_payout_id
ON payout_events (payout_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_events_seller_id
ON payout_events (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seller_payout_account_events_seller_uid
ON seller_payout_account_events (seller_uid, created_at DESC);
