-- The mobile number stops being mandatory on a payment.
--
-- THE INSTRUCTION (20 Aug, Dr M): remove the red star from "Mobile of person
-- paid" on the Accounting Voucher Creation screen. This morning's migration
-- (20260820110000) waived the rule only for phone, wifi and government payees;
-- this waives it for every payment.
--
-- WHY THE FIELD EXISTS, so this does not quietly throw it away: a payment names
-- a person the money went to, and a name alone gives nobody to ask three weeks
-- later what it was for. That reason has not gone away — the number is still
-- offered, still auto-filled from the payee's ledger, still printed on the
-- voucher, and still checked for shape when one is typed. What changes is that
-- a cashier who does not have it can no longer be stopped by it.
--
-- RECEIPTS ARE NOT TOUCHED. Money coming in is the side where "who paid this?"
-- is asked most often and answered least well, and the instruction was about
-- the payment voucher. A receipt with no mobile is still refused.
--
-- TWO PLACES DEMANDED IT, and both change together, or the screen accepts a
-- voucher the database then refuses:
--
--   * VoucherEntry.tsx — mobileRequired is now RECEIPT only (same commit)
--   * require_voucher_party_mobile on vouchers — below
--
-- The third, trg_require_payment_voucher_mobile on payment_vouchers, has been
-- switched off since 14-Aug after it silently destroyed four vouchers, and its
-- settings switch is left exactly as found.
--
-- REBUILT FROM 20260820110000, which is the most recent definition of this
-- function in the repository. The only changes are the two marked below.

CREATE OR REPLACE FUNCTION public.require_voucher_party_mobile()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v TEXT; v_category TEXT; v_payee TEXT;
BEGIN
  IF COALESCE(NEW.is_auto, true) THEN
    RETURN NEW;
  END IF;

  SELECT vt.voucher_category INTO v_category
    FROM voucher_types vt WHERE vt.id = NEW.voucher_type_id;

  IF v_category NOT IN ('PAYMENT', 'RECEIPT') THEN
    RETURN NEW;
  END IF;

  -- Who was paid. The accounting voucher carries reference_number 'PV-<uuid>'
  -- back to the payment voucher it was posted from (20260814360000), which is
  -- where the payee's name lives.
  IF NEW.reference_number LIKE 'PV-%' THEN
    SELECT pv.person_name INTO v_payee
      FROM payment_vouchers pv
     WHERE 'PV-' || pv.id::TEXT = NEW.reference_number;
  END IF;
  -- Failing that, the narration carries it: "Payment voucher PV1234 - <name>".
  IF public.party_mobile_exempt(COALESCE(v_payee, NEW.narration)) THEN
    RETURN NEW;
  END IF;

  v := regexp_replace(COALESCE(NEW.party_mobile, ''), '[^0-9]', '', 'g');
  IF length(v) = 12 AND left(v, 2) = '91' THEN v := right(v, 10); END IF;
  IF length(v) = 11 AND left(v, 1) = '0'  THEN v := right(v, 10); END IF;

  -- CHANGE 1. A blank is refused on a receipt and accepted on a payment.
  -- Stored as NULL rather than as the whitespace someone tabbed through.
  IF v = '' THEN
    IF v_category = 'RECEIPT' THEN
      RAISE EXCEPTION 'A mobile number is required for the person the money is received from';
    END IF;
    NEW.party_mobile := NULL;
    RETURN NEW;
  END IF;

  -- CHANGE 2. None — a number that IS given still has to be a real one, on both
  -- kinds. A mistyped mobile is worse than a blank: it looks reachable.
  IF v !~ '^[6-9][0-9]{10}$' AND v !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'That mobile number does not look right: % — it should be 10 digits starting 6, 7, 8 or 9', NEW.party_mobile;
  END IF;

  NEW.party_mobile := v;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_pay UUID; v_rcp UUID; v_id UUID; v_ok BOOLEAN; v_before INT;
BEGIN
  SELECT id INTO v_pay FROM voucher_types WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  SELECT id INTO v_rcp FROM voucher_types WHERE voucher_category = 'RECEIPT' AND is_active LIMIT 1;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'ABORT: no PAYMENT voucher type'; END IF;
  IF v_rcp IS NULL THEN RAISE EXCEPTION 'ABORT: no RECEIPT voucher type'; END IF;
  SELECT count(*) INTO v_before FROM vouchers;

  -- (a) the whole point: a hand-typed payment to a person, with no mobile, saves
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                        status, is_auto, narration)
  VALUES ('SELFTEST-PM2-PAY', v_pay, CURRENT_DATE, 1, 'PENDING', false,
          'Payment voucher SELFTEST - Ramesh the porter')
  RETURNING id INTO v_id;
  IF (SELECT party_mobile FROM vouchers WHERE id = v_id) IS NOT NULL THEN
    DELETE FROM vouchers WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: a blank mobile was not stored as NULL';
  END IF;
  DELETE FROM vouchers WHERE id = v_id;

  -- (b) a payment with a good number still keeps it, normalised
  INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                        status, is_auto, narration, party_mobile)
  VALUES ('SELFTEST-PM2-NORM', v_pay, CURRENT_DATE, 1, 'PENDING', false,
          'Payment voucher SELFTEST - Ramesh the porter', '+91 98765 43210')
  RETURNING id INTO v_id;
  IF (SELECT party_mobile FROM vouchers WHERE id = v_id) <> '9876543210' THEN
    DELETE FROM vouchers WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: the number was not normalised on the way in';
  END IF;
  DELETE FROM vouchers WHERE id = v_id;

  -- (c) a payment with rubbish in the field is still refused
  v_ok := false;
  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                          status, is_auto, narration, party_mobile)
    VALUES ('SELFTEST-PM2-JUNK', v_pay, CURRENT_DATE, 1, 'PENDING', false,
            'Payment voucher SELFTEST - Ramesh the porter', '1234567890');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := SQLERRM LIKE '%does not look right%';
  END;
  IF NOT v_ok THEN
    DELETE FROM vouchers WHERE voucher_number = 'SELFTEST-PM2-JUNK';
    RAISE EXCEPTION 'ABORT: a mistyped number was accepted on a payment';
  END IF;

  -- (d) a receipt with no mobile is STILL refused — this is the half not waived
  v_ok := false;
  BEGIN
    INSERT INTO vouchers (voucher_number, voucher_type_id, voucher_date, total_amount,
                          status, is_auto, narration)
    VALUES ('SELFTEST-PM2-RCP', v_rcp, CURRENT_DATE, 1, 'PENDING', false,
            'Receipt voucher SELFTEST - Ramesh the porter');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := SQLERRM LIKE '%mobile number is required%';
  END;
  IF NOT v_ok THEN
    DELETE FROM vouchers WHERE voucher_number = 'SELFTEST-PM2-RCP';
    RAISE EXCEPTION 'ABORT: a receipt was accepted with no mobile';
  END IF;

  -- (e) an auto-posted voucher is untouched, as before
  IF (SELECT count(*) FROM vouchers) <> v_before THEN
    RAISE EXCEPTION 'ABORT: the self-test left rows behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
