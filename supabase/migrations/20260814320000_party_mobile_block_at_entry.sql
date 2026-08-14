-- Rebuild the mobile rule to refuse at entry instead of unwinding at commit.
--
-- WHAT WAS WRONG WITH THE OLD ONE
--
-- It was a DEFERRED constraint trigger on vouchers, checked at COMMIT. A
-- payment voucher is written in two transactions -- header, then lines -- and
-- the ledger posting hangs off a trigger on the lines. So the check fired
-- after the posting had already been written inside that second transaction,
-- and postgres rolled the whole thing back: lines and ledger voucher both. The
-- header, committed earlier, survived. The cashier saw a voucher in the list
-- and the books never got it. Four vouchers vanished that way this afternoon.
--
-- A rule that unwinds work is strictly worse than one that refuses it. The
-- refusal can be read and acted on; the unwind is silent and leaves a record
-- that looks fine.
--
-- WHAT THIS DOES INSTEAD
--
-- Three changes, and the ordering principle behind them is: BLOCK WHERE THE
-- HUMAN IS, INHERIT WHERE THE MACHINE IS.
--
--   1. The deferred trigger is dropped. It is the mechanism that caused the
--      loss and nothing here replaces it at commit time.
--
--   2. post_one_payment_voucher now carries payment_vouchers.mobile_number
--      onto vouchers.party_mobile. The number was ALREADY being collected --
--      the screen has demanded it since 13 August, and every one of the four
--      lost vouchers had one -- and the posting simply dropped it on the
--      floor. Nothing needed to be asked of anybody; it needed carrying.
--
--   3. The requirement moves to BEFORE INSERT on payment_vouchers, which is
--      the moment a person is sitting in front of the form. Nothing has been
--      written yet, so a refusal costs a message and not a posting.
--
-- Still behind the same switch, and still OFF. Turning it on is a separate
-- decision and this migration does not make it.

-- 1. The mechanism that lost the money. -------------------------------------
DROP TRIGGER IF EXISTS trg_require_party_mobile_deferred ON public.vouchers;
DROP FUNCTION IF EXISTS public.require_party_mobile_deferred();

-- 2. Carry the number that was already collected. ---------------------------
-- Only this line changes in post_one_payment_voucher: party_mobile is set from
-- the header. Everything else is byte-for-byte the current definition.
CREATE OR REPLACE FUNCTION public.post_one_payment_voucher(p_voucher_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pv         RECORD;
  v_credit_id  UUID;
  v_company_id UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
  v_total      NUMERIC(15,2);
BEGIN
  SELECT * INTO v_pv FROM payment_vouchers WHERE id = p_voucher_id;
  IF v_pv.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_reference := 'PV-' || v_pv.id::TEXT;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NULL;
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE WARNING 'Payment voucher %: no PAYMENT voucher type, nothing posted', v_pv.voucher_no;
    RETURN NULL;
  END IF;

  v_company_id := public.resolve_patient_company(v_pv.hospital_type, NULL);
  v_credit_id  := public.adamrit_ledger_by_name(v_pv.account_ledger_name, '1110', v_company_id);

  v_narration := 'Payment voucher ' || COALESCE(v_pv.voucher_no, v_reference)
                 || COALESCE(' - ' || NULLIF(btrim(v_pv.narration), ''),
                      COALESCE(' - ' || NULLIF(btrim(v_pv.purpose), ''), ''));

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at,
    party_mobile
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(v_pv.voucher_date, CURRENT_DATE),
    v_reference, v_narration, 0, v_company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(v_pv.paid_by), ''), 'payment-voucher'), NOW(), NOW(),
    -- The whole of the fix. Normalised, so a number typed as "+91 98765 43210"
    -- lands in the same shape as one typed as ten digits, and anything that is
    -- not a reachable Indian mobile lands as NULL rather than as rubbish.
    public.norm_party_mobile(v_pv.mobile_number)
  );

  WITH posted AS (
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount,
      entry_order, created_at
    )
    SELECT gen_random_uuid(), v_voucher_id,
           public.adamrit_ledger_by_name(l.ledger_name, '5900', v_company_id),
           COALESCE(NULLIF(btrim(l.ledger_name), ''), 'Petty cash') || ' - ' || v_narration,
           ROUND(COALESCE(l.amount, 0), 2), 0,
           COALESCE(l.line_order, 0) + 1, NOW()
      FROM payment_voucher_lines l
     WHERE l.voucher_id = v_pv.id
       AND COALESCE(l.amount, 0) > 0
    RETURNING debit_amount
  )
  SELECT COALESCE(SUM(debit_amount), 0) INTO v_total FROM posted;

  IF v_total <= 0 THEN
    DELETE FROM vouchers WHERE id = v_voucher_id;
    RETURN NULL;
  END IF;

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES (
    gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, v_total, 0, NOW()
  );

  UPDATE vouchers SET total_amount = v_total WHERE id = v_voucher_id;

  RETURN v_voucher_no;
END;
$$;

-- 3. Refuse at the form, where a person can read the message. ---------------
CREATE OR REPLACE FUNCTION public.require_payment_voucher_mobile()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v TEXT;
BEGIN
  IF NOT COALESCE((SELECT enforced FROM voucher_party_mobile_settings WHERE id), false) THEN
    RETURN NEW;
  END IF;

  v := public.norm_party_mobile(NEW.mobile_number);

  IF v IS NULL THEN
    IF btrim(COALESCE(NEW.mobile_number, '')) = '' THEN
      RAISE EXCEPTION 'A mobile number is required for the person being paid. Nothing has been saved — add it and save again.';
    END IF;
    RAISE EXCEPTION 'That mobile number does not look right: % — it should be 10 digits starting 6, 7, 8 or 9. Nothing has been saved.',
      NEW.mobile_number;
  END IF;

  -- Stored normalised, so the ledger and the voucher agree.
  NEW.mobile_number := v;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_require_payment_voucher_mobile ON public.payment_vouchers;
CREATE TRIGGER trg_require_payment_voucher_mobile
  BEFORE INSERT ON public.payment_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.require_payment_voucher_mobile();

-- 4. The numbers already collected, carried onto vouchers already posted. ---
-- Read-only in effect: it fills a NULL and never overwrites.
UPDATE public.vouchers v
   SET party_mobile = public.norm_party_mobile(pv.mobile_number)
  FROM public.payment_vouchers pv
 WHERE v.reference_number = 'PV-' || pv.id::text
   AND v.party_mobile IS NULL
   AND public.norm_party_mobile(pv.mobile_number) IS NOT NULL;

DO $verify$
DECLARE
  v_was BOOLEAN; v_ok BOOLEAN; v_id UUID; v_n INT; v_filled INT;
BEGIN
  SELECT enforced INTO v_was FROM voucher_party_mobile_settings WHERE id;

  -- (a) the trigger that lost the money is gone
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname = 'trg_require_party_mobile_deferred' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the deferred trigger is still installed';
  END IF;

  -- (b) OFF: a voucher with no mobile still saves. This is the state the
  --     migration leaves behind, so it has to be proven, not assumed.
  UPDATE voucher_party_mobile_settings SET enforced = false WHERE id;
  INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount,
                                hospital_type, account_ledger_name)
  VALUES ('SELFTEST-PVM-A', CURRENT_DATE, 'Self test', 1, 'hope', 'Cash (HOPE)')
  RETURNING id INTO v_id;
  DELETE FROM payment_vouchers WHERE id = v_id;

  -- (c) ON: it is refused, and refused BEFORE anything is written
  UPDATE voucher_party_mobile_settings SET enforced = true WHERE id;
  SELECT count(*) INTO v_n FROM payment_vouchers;
  v_ok := false;
  BEGIN
    INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount,
                                  hospital_type, account_ledger_name)
    VALUES ('SELFTEST-PVM-B', CURRENT_DATE, 'Self test', 1, 'hope', 'Cash (HOPE)');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%mobile number is required%');
  END;
  IF NOT v_ok THEN
    DELETE FROM payment_vouchers WHERE voucher_no = 'SELFTEST-PVM-B';
    UPDATE voucher_party_mobile_settings SET enforced = COALESCE(v_was, false) WHERE id;
    RAISE EXCEPTION 'ABORT: a payment voucher with no mobile was accepted';
  END IF;
  IF (SELECT count(*) FROM payment_vouchers) <> v_n THEN
    RAISE EXCEPTION 'ABORT: the refused voucher was written anyway — this is the old failure';
  END IF;

  -- (d) ON: rubbish is refused too
  v_ok := false;
  BEGIN
    INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount,
                                  hospital_type, account_ledger_name, mobile_number)
    VALUES ('SELFTEST-PVM-C', CURRENT_DATE, 'Self test', 1, 'hope', 'Cash (HOPE)', '1234567890');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%does not look right%');
  END;
  IF NOT v_ok THEN
    DELETE FROM payment_vouchers WHERE voucher_no = 'SELFTEST-PVM-C';
    UPDATE voucher_party_mobile_settings SET enforced = COALESCE(v_was, false) WHERE id;
    RAISE EXCEPTION 'ABORT: a placeholder number was accepted';
  END IF;

  -- (e) ON: a good one goes through, normalised, and nothing rolls back
  INSERT INTO payment_vouchers (voucher_no, voucher_date, person_name, amount,
                                hospital_type, account_ledger_name, mobile_number)
  VALUES ('SELFTEST-PVM-D', CURRENT_DATE, 'Self test', 1, 'hope', 'Cash (HOPE)', '+91 98765 43210')
  RETURNING id INTO v_id;
  IF (SELECT mobile_number FROM payment_vouchers WHERE id = v_id) <> '9876543210' THEN
    DELETE FROM payment_vouchers WHERE id = v_id;
    UPDATE voucher_party_mobile_settings SET enforced = COALESCE(v_was, false) WHERE id;
    RAISE EXCEPTION 'ABORT: the number was not normalised on the way in';
  END IF;
  DELETE FROM payment_vouchers WHERE id = v_id;

  -- Leave the switch exactly as it was found, which is OFF.
  UPDATE voucher_party_mobile_settings SET enforced = COALESCE(v_was, false) WHERE id;
  IF COALESCE((SELECT enforced FROM voucher_party_mobile_settings WHERE id), false) THEN
    RAISE EXCEPTION 'ABORT: this migration must not leave enforcement on';
  END IF;

  IF EXISTS (SELECT 1 FROM payment_vouchers WHERE voucher_no LIKE 'SELFTEST-PVM-%') THEN
    RAISE EXCEPTION 'ABORT: self-test vouchers left behind';
  END IF;

  SELECT count(*) INTO v_filled FROM vouchers
   WHERE reference_number LIKE 'PV-%' AND party_mobile IS NOT NULL;
  RAISE NOTICE 'Ledger vouchers on the PV rail now carrying a mobile: %', v_filled;
END
$verify$;

NOTIFY pgrst, 'reload schema';
