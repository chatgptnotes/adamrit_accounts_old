-- Require a mobile number on every payment and receipt, automatic ones too.
--
-- The existing rule (20260813240000) covers hand-typed PAYMENT and RECEIPT
-- vouchers only. This extends it to automatic postings, which is where almost
-- all of the money actually moves.
--
-- TWO THINGS MAKE THIS HARDER THAN A ONE-LINE CHANGE.
--
-- 1. Timing. The existing rule is BEFORE INSERT on vouchers. The number for an
--    automatic posting is resolved from the ledger by a trigger on
--    voucher_entries, which runs AFTER the voucher row already exists. Checked
--    at BEFORE INSERT, every automatic posting would fail on a number that was
--    about to be filled in a moment later. So this is a CONSTRAINT TRIGGER,
--    DEFERRABLE INITIALLY DEFERRED: it fires at COMMIT, by which time the
--    entries are in and the ledger has had its say.
--
-- 2. Coverage. Measured on live data before writing this. Of the 47 payment
--    and receipt vouchers posted since the auto-fill trigger went live at
--    03:20 today, 25 carry no number -- 53%. Active ledgers: patients 5,516 of
--    5,811, Tally-imported 8 of 2,309, suppliers/staff/consultants 11 of
--    2,133. Switched on today, this would refuse better than half of
--    everything, including supplier and salary payments.
--
-- So the rule is installed, tested and live, and its enforcement is OFF. That
-- is deliberate and it is the one thing here that was not asked for: turning
-- it on before the ledgers carry numbers stops the hospital taking and paying
-- money within the hour, and that decision should be made against the 53%
-- rather than in spite of it.
--
--   Switch it on:   UPDATE public.voucher_party_mobile_settings SET enforced = true  WHERE id;
--   Switch it off:  UPDATE public.voucher_party_mobile_settings SET enforced = false WHERE id;
--
-- One row, one boolean, instant either way, and the counter is never left
-- waiting on a migration to be applied at an awkward hour.

CREATE TABLE IF NOT EXISTS public.voucher_party_mobile_settings (
  id        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enforced  BOOLEAN NOT NULL DEFAULT false,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.voucher_party_mobile_settings (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.voucher_party_mobile_settings IS
  'One row. enforced = true refuses any PAYMENT or RECEIPT voucher with no '
  'party mobile, automatic postings included.';

ALTER TABLE public.voucher_party_mobile_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voucher_party_mobile_settings_read ON public.voucher_party_mobile_settings;
CREATE POLICY voucher_party_mobile_settings_read
  ON public.voucher_party_mobile_settings FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.require_party_mobile_deferred()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_category TEXT; v_ledger TEXT; v_mobile TEXT; v_no TEXT; v_type UUID;
BEGIN
  IF NOT COALESCE((SELECT enforced FROM voucher_party_mobile_settings WHERE id), false) THEN
    RETURN NULL;
  END IF;

  -- Read the row as it stands NOW, not as NEW holds it.
  --
  -- This trigger is deferred to commit, and a deferred trigger is handed the
  -- tuple as it was at INSERT -- so NEW.party_mobile is still the NULL it was
  -- written with, even after the voucher_entries trigger has filled the real
  -- number in. Trusting NEW here refused every automatic posting, including
  -- the ones against ledgers that do carry a number.
  --
  -- No row means it was inserted and deleted inside the same transaction.
  -- Nothing was posted, so there is nothing to require.
  SELECT party_mobile, voucher_number, voucher_type_id
    INTO v_mobile, v_no, v_type
    FROM vouchers WHERE id = NEW.id;
  IF NOT FOUND OR v_mobile IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT vt.voucher_category INTO v_category
    FROM voucher_types vt WHERE vt.id = v_type;
  IF v_category IS NULL OR v_category NOT IN ('PAYMENT', 'RECEIPT') THEN
    RETURN NULL;
  END IF;

  -- Name the ledger. "A mobile number is required" sends a cashier hunting;
  -- "Sunrise Traders has no mobile number" tells them exactly what to fix.
  SELECT string_agg(DISTINCT coa.account_name, ', ') INTO v_ledger
    FROM voucher_entries ve
    JOIN chart_of_accounts coa ON coa.id = ve.account_id
   WHERE ve.voucher_id = NEW.id;

  RAISE EXCEPTION
    'Voucher % cannot be posted: there is no mobile number for the other party. Add one to the ledger (%) in Masters, then post again.',
    COALESCE(v_no, '(unnumbered)'), COALESCE(v_ledger, 'not recorded');
END $$;

DROP TRIGGER IF EXISTS trg_require_party_mobile_deferred ON public.vouchers;
CREATE CONSTRAINT TRIGGER trg_require_party_mobile_deferred
  AFTER INSERT ON public.vouchers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.require_party_mobile_deferred();

DO $verify$
DECLARE
  v_pay UUID; v_jv UUID; v_bare UUID; v_numbered UUID;
  v_id UUID; v_ok BOOLEAN; v_was BOOLEAN;
BEGIN
  SELECT enforced INTO v_was FROM voucher_party_mobile_settings WHERE id;

  SELECT id INTO v_pay FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_jv  FROM voucher_types WHERE voucher_category = 'JOURNAL' AND is_active LIMIT 1;
  IF v_pay IS NULL OR v_jv IS NULL THEN
    RAISE EXCEPTION 'ABORT: need a PAYMENT and a JOURNAL voucher type to self-test';
  END IF;

  SELECT id INTO v_bare FROM chart_of_accounts WHERE mobile IS NULL AND is_active LIMIT 1;
  SELECT id INTO v_numbered FROM chart_of_accounts WHERE mobile IS NOT NULL AND is_active LIMIT 1;
  IF v_bare IS NULL OR v_numbered IS NULL THEN
    RAISE EXCEPTION 'ABORT: need one ledger with a number and one without to self-test';
  END IF;

  -- (a) OFF: an automatic payment against a numberless ledger still posts.
  --     This is the state the migration leaves behind, so it must be proven.
  UPDATE voucher_party_mobile_settings SET enforced = false WHERE id;
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES ('SELFTEST-PM-A', v_pay, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
  INSERT INTO voucher_entries (voucher_id, account_id, debit_amount, credit_amount, entry_order)
  VALUES (v_id, v_bare, 1, 0, 1);
  SET CONSTRAINTS ALL IMMEDIATE;   -- force the deferred check to fire here
  DELETE FROM voucher_entries WHERE voucher_id = v_id;
  DELETE FROM vouchers WHERE id = v_id;
  SET CONSTRAINTS ALL DEFERRED;

  -- (b) ON: the same posting is refused.
  UPDATE voucher_party_mobile_settings SET enforced = true WHERE id;
  v_ok := false;
  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
    VALUES ('SELFTEST-PM-B', v_pay, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
    INSERT INTO voucher_entries (voucher_id, account_id, debit_amount, credit_amount, entry_order)
    VALUES (v_id, v_bare, 1, 0, 1);
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%no mobile number for the other party%');
  END;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: enforcement did not refuse a numberless automatic payment';
  END IF;

  -- (c) ON: a posting against a ledger that HAS a number goes through, with
  --     the number filled in from the ledger rather than typed. This is the
  --     case that proves the deferred timing works at all.
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES ('SELFTEST-PM-C', v_pay, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
  INSERT INTO voucher_entries (voucher_id, account_id, debit_amount, credit_amount, entry_order)
  VALUES (v_id, v_numbered, 1, 0, 1);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF (SELECT party_mobile FROM vouchers WHERE id = v_id) IS NULL THEN
    RAISE EXCEPTION 'ABORT: the ledger number was not carried onto the voucher';
  END IF;
  DELETE FROM voucher_entries WHERE voucher_id = v_id;
  DELETE FROM vouchers WHERE id = v_id;
  SET CONSTRAINTS ALL DEFERRED;

  -- (d) ON: a journal is untouched. Moving money between your own ledgers has
  --     no counterparty, and a contra deposit must never need a phone number.
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES ('SELFTEST-PM-D', v_jv, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
  SET CONSTRAINTS ALL IMMEDIATE;
  DELETE FROM vouchers WHERE id = v_id;
  SET CONSTRAINTS ALL DEFERRED;

  -- Leave enforcement exactly as it was found, which for a first run is OFF.
  UPDATE voucher_party_mobile_settings SET enforced = COALESCE(v_was, false) WHERE id;

  IF EXISTS (SELECT 1 FROM vouchers WHERE voucher_number LIKE 'SELFTEST-PM-%') THEN
    RAISE EXCEPTION 'ABORT: self-test vouchers were left behind';
  END IF;

  RAISE NOTICE 'Rule installed. Enforcement is %',
    CASE WHEN COALESCE(v_was, false) THEN 'ON' ELSE 'OFF -- switch it on when the ledgers carry numbers' END;
END
$verify$;

NOTIFY pgrst, 'reload schema';
