-- Parse the Yojna bill dates instead of casting them, so saving a bill cannot fail.
--
-- yojna_bills.date_of_invoice and date_of_discharge are TEXT, and they hold
-- dd-mm-yyyy - '20-02-2026'. The accrual cast them straight to DATE, which
-- raises 22008 on that format. Because the cast happens inside an AFTER trigger
-- the error propagates to the caller, so the bill save itself would fail. That
-- is worse than not posting: it breaks a working screen.
--
-- The test did not catch it because it inserted CURRENT_DATE, which lands in a
-- text column as iso yyyy-mm-dd and casts cleanly. A fixture that happened to
-- be well formed hid a format the real data is full of.
--
-- parse_bill_date reads dd-mm-yyyy and dd/mm/yyyy first, then falls back to
-- whatever Postgres can make of the string, and returns NULL rather than
-- raising when it can make nothing. An unreadable date then falls through to
-- the discharge date and finally to today - the voucher still posts, dated
-- imperfectly, instead of the bill refusing to save.

CREATE OR REPLACE FUNCTION public.parse_bill_date(p_text TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_in TEXT := NULLIF(btrim(COALESCE(p_text, '')), '');
BEGIN
  IF v_in IS NULL THEN
    RETURN NULL;
  END IF;

  -- The format the bill pages write. Checked first, because '03-04-2026' is a
  -- valid iso-ish string to Postgres only by accident and would read as March.
  IF v_in ~ '^\d{1,2}-\d{1,2}-\d{4}$' THEN
    BEGIN RETURN to_date(v_in, 'DD-MM-YYYY'); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  END IF;

  IF v_in ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    BEGIN RETURN to_date(v_in, 'DD/MM/YYYY'); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  END IF;

  BEGIN RETURN v_in::DATE; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
END;
$$;

COMMENT ON FUNCTION public.parse_bill_date(TEXT) IS
  'Reads a bill date held as text, dd-mm-yyyy first. Returns NULL rather than '
  'raising, so a malformed date never propagates out of a trigger and blocks a save.';

-- The accrual again, unchanged but for the two dates.
CREATE OR REPLACE FUNCTION public.accrue_yojna_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount     NUMERIC(15,2);
  v_debtor_id  UUID;
  v_ledger_pid UUID;
  v_income_id  UUID;
  v_company_id UUID;
  v_patient    RECORD;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
BEGIN
  v_reference := 'YOJNA-' || NEW.id::TEXT;

  -- A save that changes nothing the ledger cares about is not a correction.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.total_amount, 0) = COALESCE(OLD.total_amount, 0)
     AND lower(btrim(COALESCE(NEW.corporate_name, ''))) = lower(btrim(COALESCE(OLD.corporate_name, '')))
     AND NEW.date_of_invoice IS NOT DISTINCT FROM OLD.date_of_invoice THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE vouchers
       SET status = 'CANCELLED',
           last_modified_by = 'yojna-bill-edited',
           updated_at = now()
     WHERE reference_number = v_reference AND status <> 'CANCELLED';
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  v_amount := GREATEST(COALESCE(NEW.total_amount, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- If a final bill for this visit has already accrued, the episode is in the
  -- books. Posting the claim as well would count it twice.
  IF EXISTS (
    SELECT 1
      FROM bills b
      JOIN vouchers vv ON vv.bill_id = b.id AND vv.status <> 'CANCELLED'
     WHERE b.visit_id = NEW.visit_id
  ) THEN
    RAISE WARNING 'Visit %: final bill already accrued, Yojna bill % not posted',
      NEW.visit_id, NEW.invoice_no;
    RETURN NEW;
  END IF;

  SELECT p.id, p.patients_id, p.hospital_name, p.name AS patient_name
    INTO v_patient
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
   WHERE v.visit_id = NEW.visit_id
   LIMIT 1;

  -- The scheme carries the claim. corporate_name is the scheme as written on
  -- the bill, mapped through the same corporate.ledger_account_id the payer
  -- split uses, so a Yojna claim and a panel claim land on the same ledger.
  SELECT c.ledger_account_id INTO v_debtor_id
    FROM corporate c
   WHERE lower(btrim(c.name)) = lower(btrim(COALESCE(NEW.corporate_name, '')))
     AND c.ledger_account_id IS NOT NULL
   LIMIT 1;

  IF v_debtor_id IS NULL AND v_patient.id IS NOT NULL THEN
    SELECT pl.account_id, pl.id INTO v_debtor_id, v_ledger_pid
      FROM patient_ledgers pl WHERE pl.patient_id = v_patient.id;
    IF v_debtor_id IS NULL THEN
      SELECT id INTO v_debtor_id FROM chart_of_accounts
       WHERE account_code = 'PT' || v_patient.patients_id;
    END IF;
    RAISE WARNING 'Yojna bill %: scheme % has no ledger, the patient carries the claim',
      NEW.invoice_no, NEW.corporate_name;
  END IF;

  SELECT id INTO v_income_id FROM chart_of_accounts WHERE account_code = '4160';
  v_company_id := public.resolve_patient_company(
                    COALESCE(NEW.hospital_name, v_patient.hospital_name),
                    NEW.corporate_name);

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'SALES' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'SV' THEN 1 WHEN 'SAL' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_debtor_id IS NULL OR v_income_id IS NULL THEN
    RAISE WARNING 'Yojna bill %: ledgers or voucher type missing, nothing accrued',
      NEW.invoice_no;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Yojna claim ' || COALESCE(NULLIF(btrim(NEW.invoice_no), ''), v_reference)
                  || COALESCE(' - ' || NULLIF(btrim(NEW.corporate_name), ''), '')
                  || COALESCE(' - ' || NULLIF(btrim(COALESCE(NEW.patient_name,
                                                             v_patient.patient_name)), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(public.parse_bill_date(NEW.date_of_invoice::TEXT),
             public.parse_bill_date(NEW.date_of_discharge::TEXT),
             CURRENT_DATE),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    COALESCE(NEW.created_by::TEXT, 'yojna-bill'), NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, patient_ledger_id, narration,
    debit_amount, credit_amount, entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor_id, v_ledger_pid,
     v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_income_id, NULL,
     v_narration, 0, v_amount, 2, NOW());

  RAISE NOTICE 'Yojna bill %: accrued Rs % against %',
    NEW.invoice_no, v_amount, COALESCE(NEW.corporate_name, 'the patient');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accrue_yojna_bill ON public.yojna_bills;
CREATE TRIGGER trg_accrue_yojna_bill
AFTER INSERT OR UPDATE OF total_amount, corporate_name, date_of_invoice
ON public.yojna_bills
FOR EACH ROW
EXECUTE FUNCTION public.accrue_yojna_bill();
