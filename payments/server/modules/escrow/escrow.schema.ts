import { getPaymentDb } from '../../postgresCompat.js';

const db = getPaymentDb();

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_escrows_order_id_unique
  ON escrows (order_id);

  DROP TRIGGER IF EXISTS trg_guard_escrow_terminal_state ON escrows;

  CREATE OR REPLACE FUNCTION guard_escrow_terminal_state()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.state = 'released' AND NEW.state = 'released' AND OLD.entries IS DISTINCT FROM NEW.entries THEN
      RAISE EXCEPTION 'Escrow is already released';
    END IF;

    IF OLD.state = 'refunded' AND NEW.state = 'refunded' AND OLD.entries IS DISTINCT FROM NEW.entries THEN
      RAISE EXCEPTION 'Escrow is already refunded';
    END IF;

    IF OLD.state IN ('released', 'refunded', 'closed')
      AND NEW.state IN ('funded', 'held')
    THEN
      RAISE EXCEPTION 'Escrow cannot move from terminal state % to %', OLD.state, NEW.state;
    END IF;

    IF OLD.state = 'released' AND NEW.state = 'refunded' THEN
      RAISE EXCEPTION 'Escrow is already released';
    END IF;

    IF OLD.state = 'refunded' AND NEW.state = 'released' THEN
      RAISE EXCEPTION 'Escrow is already refunded';
    END IF;

    RETURN NEW;
  END;
  $$;

  CREATE TRIGGER trg_guard_escrow_terminal_state
  BEFORE UPDATE ON escrows
  FOR EACH ROW
  EXECUTE FUNCTION guard_escrow_terminal_state();
`);
