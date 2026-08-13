-- A payment voucher must name a reachable person.
--
-- Cash goes out against a person's name and nothing else: no number, no way to
-- ring whoever took Rs 634 for the canteen three weeks later and ask what it
-- was. The mobile number is now required to file one.
--
-- Enforced by a trigger on INSERT rather than NOT NULL, so the 280-odd vouchers
-- already filed stay exactly as they are. Backfilling them would mean inventing
-- numbers, and a made-up number is worse than a blank one.

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS mobile_number TEXT;

-- Format is checked for every row that has one, old or new: ten digits opening
-- 6-9, which is every Indian mobile. Spaces, +91 and dashes are stripped by the
-- trigger before this sees them.
ALTER TABLE public.payment_vouchers
  DROP CONSTRAINT IF EXISTS payment_vouchers_mobile_format_ck;
ALTER TABLE public.payment_vouchers
  ADD CONSTRAINT payment_vouchers_mobile_format_ck
  CHECK (mobile_number IS NULL OR mobile_number ~ '^[6-9][0-9]{9}$');

CREATE OR REPLACE FUNCTION public.require_payment_voucher_mobile()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v TEXT;
BEGIN
  -- Accept what a human types -- "+91 98765 43210", "098765-43210" -- and store
  -- the ten digits. Rejecting a real number over its punctuation would just
  -- teach staff to work around the field.
  v := regexp_replace(COALESCE(NEW.mobile_number, ''), '[^0-9]', '', 'g');
  IF length(v) = 12 AND left(v, 2) = '91' THEN v := right(v, 10); END IF;
  IF length(v) = 11 AND left(v, 1) = '0'  THEN v := right(v, 10); END IF;

  IF v = '' THEN
    RAISE EXCEPTION 'A mobile number is required for the person being paid';
  END IF;
  IF v !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'That mobile number does not look right: % — it should be 10 digits starting 6, 7, 8 or 9', NEW.mobile_number;
  END IF;

  NEW.mobile_number := v;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_require_payment_voucher_mobile ON public.payment_vouchers;
CREATE TRIGGER trg_require_payment_voucher_mobile
  BEFORE INSERT ON public.payment_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.require_payment_voucher_mobile();

COMMENT ON COLUMN public.payment_vouchers.mobile_number IS
  'Ten digits, of the person the cash was paid to. Required on new vouchers.';

DO $verify$
DECLARE v_ok BOOLEAN; v_id UUID; v_stored TEXT;
BEGIN
  -- (a) no number at all is refused
  v_ok := false;
  BEGIN
    INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount, hospital_type)
    VALUES ('PV-SELFTEST-A', CURRENT_DATE, 'selftest', 1, 'hope');
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM payment_vouchers WHERE voucher_no = 'PV-SELFTEST-A';
    RAISE EXCEPTION 'ABORT: a voucher with no mobile number was accepted';
  END IF;

  -- (b) a nonsense number is refused
  v_ok := false;
  BEGIN
    INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount, hospital_type, mobile_number)
    VALUES ('PV-SELFTEST-B', CURRENT_DATE, 'selftest', 1, 'hope', '12345');
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM payment_vouchers WHERE voucher_no = 'PV-SELFTEST-B';
    RAISE EXCEPTION 'ABORT: an invalid mobile number was accepted';
  END IF;

  -- (c) a real number typed with +91 and spaces is accepted and normalised
  INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount, hospital_type, mobile_number)
  VALUES ('PV-SELFTEST-C', CURRENT_DATE, 'selftest', 1, 'hope', '+91 98765 43210')
  RETURNING id, mobile_number INTO v_id, v_stored;
  IF v_stored <> '9876543210' THEN
    DELETE FROM payment_vouchers WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: "+91 98765 43210" stored as "%"', v_stored;
  END IF;
  DELETE FROM payment_vouchers WHERE id = v_id;

  IF EXISTS (SELECT 1 FROM payment_vouchers WHERE voucher_no LIKE 'PV-SELFTEST-%') THEN
    RAISE EXCEPTION 'ABORT: self-test rows were left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
