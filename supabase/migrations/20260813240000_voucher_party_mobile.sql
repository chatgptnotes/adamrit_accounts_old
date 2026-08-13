-- A hand-typed payment or receipt must name a reachable person.
--
-- The payment voucher screen already requires this. Receipts are entered only
-- through the accounting Voucher Entry screen, which writes straight to
-- vouchers, so the rule has to live here too.
--
-- Scoped deliberately and narrowly. vouchers is written by 59 migrations'
-- worth of automatic postings -- canteen collections, quick pay, RM cuts, spot
-- approvals, and the receipt trigger behind every patient advance. None of
-- those has a person to ring, and a blanket rule would stop the hospital
-- taking money. So it applies ONLY to entries a human typed (is_auto = false)
-- of category PAYMENT or RECEIPT. Contra and journal are untouched: moving
-- money between your own ledgers has no counterparty.

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS party_mobile TEXT;

ALTER TABLE public.vouchers
  DROP CONSTRAINT IF EXISTS vouchers_party_mobile_format_ck;
ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_party_mobile_format_ck
  CHECK (party_mobile IS NULL OR party_mobile ~ '^[6-9][0-9]{9}$');

CREATE OR REPLACE FUNCTION public.require_voucher_party_mobile()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v TEXT; v_category TEXT;
BEGIN
  -- Automatic postings are exempt: nothing typed them, and there is nobody to
  -- put a number against.
  IF COALESCE(NEW.is_auto, true) THEN
    RETURN NEW;
  END IF;

  SELECT vt.voucher_category INTO v_category
    FROM voucher_types vt WHERE vt.id = NEW.voucher_type_id;

  IF v_category NOT IN ('PAYMENT', 'RECEIPT') THEN
    RETURN NEW;
  END IF;

  v := regexp_replace(COALESCE(NEW.party_mobile, ''), '[^0-9]', '', 'g');
  IF length(v) = 12 AND left(v, 2) = '91' THEN v := right(v, 10); END IF;
  IF length(v) = 11 AND left(v, 1) = '0'  THEN v := right(v, 10); END IF;

  IF v = '' THEN
    RAISE EXCEPTION 'A mobile number is required for the person the money is % ',
      CASE WHEN v_category = 'PAYMENT' THEN 'paid to' ELSE 'received from' END;
  END IF;
  IF v !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'That mobile number does not look right: % — it should be 10 digits starting 6, 7, 8 or 9', NEW.party_mobile;
  END IF;

  NEW.party_mobile := v;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_require_voucher_party_mobile ON public.vouchers;
CREATE TRIGGER trg_require_voucher_party_mobile
  BEFORE INSERT ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.require_voucher_party_mobile();

COMMENT ON COLUMN public.vouchers.party_mobile IS
  'Ten digits, of the other party. Required on hand-typed PAYMENT and RECEIPT vouchers.';

DO $verify$
DECLARE
  v_pay UUID; v_jv UUID; v_ok BOOLEAN; v_id UUID; v_stored TEXT;
BEGIN
  SELECT id INTO v_pay FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_jv  FROM voucher_types WHERE voucher_category = 'JOURNAL' AND is_active LIMIT 1;
  IF v_pay IS NULL OR v_jv IS NULL THEN
    RAISE EXCEPTION 'ABORT: need a PAYMENT and a JOURNAL voucher type to self-test';
  END IF;

  -- (a) a typed payment with no number is refused
  v_ok := false;
  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
    VALUES ('SELFTEST-A', v_pay, CURRENT_DATE, 1, false, 'PENDING');
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM vouchers WHERE voucher_number = 'SELFTEST-A';
    RAISE EXCEPTION 'ABORT: a typed payment with no mobile was accepted';
  END IF;

  -- (b) an AUTOMATIC payment is exempt, or the hospital stops posting
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES ('SELFTEST-B', v_pay, CURRENT_DATE, 1, true, 'PENDING') RETURNING id INTO v_id;
  DELETE FROM vouchers WHERE id = v_id;

  -- (c) a typed JOURNAL is exempt: no counterparty
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES ('SELFTEST-C', v_jv, CURRENT_DATE, 1, false, 'PENDING') RETURNING id INTO v_id;
  DELETE FROM vouchers WHERE id = v_id;

  -- (d) a typed payment WITH a number goes through, normalised
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status, party_mobile)
  VALUES ('SELFTEST-D', v_pay, CURRENT_DATE, 1, false, 'PENDING', '+91 98765 43210')
  RETURNING id, party_mobile INTO v_id, v_stored;
  IF v_stored <> '9876543210' THEN
    DELETE FROM vouchers WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: "+91 98765 43210" stored as "%"', v_stored;
  END IF;
  DELETE FROM vouchers WHERE id = v_id;

  IF EXISTS (SELECT 1 FROM vouchers WHERE voucher_number LIKE 'SELFTEST-%') THEN
    RAISE EXCEPTION 'ABORT: self-test vouchers were left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
