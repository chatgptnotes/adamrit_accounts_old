-- Read the Yojna bill dates day-first, and fall back to the visit when the
-- date on the bill cannot be true.
--
-- WHAT SETTLED THE FORMAT. Not inference this time - the writer.
-- CorporateBill.tsx:70-72 fills both dates with date-fns format(..,'dd-MM-yyyy'),
-- which is day-month-year. The page writes day-first, so day-first is what to
-- read. My earlier switch to month-first was wrong.
--
-- WHY I GOT IT WRONG. I used the invoice number as a witness: MJPJAY-JUL-003
-- dated 07-09-2026 looked like proof of month-first, because 9 July matches
-- JUL and 7 September does not. But invoice_no comes from bills.bill_no, which
-- carries the month of treatment, not of invoicing. A July admission invoiced
-- in September is ordinary. Three coincidences became a theory, and the theory
-- doubled the impossible dates - 22 bills became 50 - which is what exposed it.
--
-- THE REAL PROBLEM IS NOT THE FORMAT. Even read correctly, some bills carry
-- dates that cannot be true: dateOfInvoice defaults to today but the field is
-- editable, so a mistyped year or month lands in the future. A voucher dated
-- ahead of today puts revenue in a period that has not happened.
--
-- So the date on the bill is used only when it is possible. When it is missing,
-- unreadable, or in the future, the visit decides - discharge date first, then
-- admission. Those are real DATE columns and cannot be misread, which is what
-- makes them worth more than a better guess at the text.

CREATE OR REPLACE FUNCTION public.parse_bill_date(p_text TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_in    TEXT := NULLIF(btrim(COALESCE(p_text, '')), '');
  v_parts TEXT[];
  v_first INT;
  v_secnd INT;
  v_year  INT;
BEGIN
  IF v_in IS NULL THEN
    RETURN NULL;
  END IF;

  v_parts := regexp_match(v_in, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$');

  IF v_parts IS NOT NULL THEN
    v_first := v_parts[1]::INT;
    v_secnd := v_parts[2]::INT;
    v_year  := v_parts[3]::INT;

    -- Day first, which is what the bill pages write.
    IF v_secnd BETWEEN 1 AND 12 AND v_first BETWEEN 1 AND 31 THEN
      BEGIN RETURN make_date(v_year, v_secnd, v_first);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    -- A second number above 12 cannot be a month, so that string is only
    -- readable month-first. make_date raises on a real impossibility rather
    -- than rolling the overflow forward the way to_date does.
    IF v_first BETWEEN 1 AND 12 AND v_secnd BETWEEN 1 AND 31 THEN
      BEGIN RETURN make_date(v_year, v_first, v_secnd);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    RETURN NULL;
  END IF;

  BEGIN RETURN v_in::DATE; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
END;
$$;

COMMENT ON FUNCTION public.parse_bill_date(TEXT) IS
  'Reads a bill date held as text. Day-first, which is what the bill pages '
  'write with dd-MM-yyyy; month-first only where the second number cannot be '
  'a month. Returns NULL rather than raising, so a bad date never blocks a save.';

-- ------------------------------------------------------------------
-- The date a Yojna voucher should carry.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.yojna_voucher_date(
  p_invoice_text   TEXT,
  p_discharge_text TEXT,
  p_visit_id       TEXT
) RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_try   DATE;
  v_visit RECORD;
BEGIN
  -- The bill's own date, but only if it could have happened.
  v_try := public.parse_bill_date(p_invoice_text);
  IF v_try IS NOT NULL AND v_try <= CURRENT_DATE THEN
    RETURN v_try;
  END IF;

  SELECT v.discharge_date, v.admission_date
    INTO v_visit
    FROM visits v
   WHERE v.visit_id = p_visit_id
   LIMIT 1;

  -- The visit's own dates are real DATE columns and cannot be misread.
  IF v_visit.discharge_date IS NOT NULL AND v_visit.discharge_date <= CURRENT_DATE THEN
    RETURN v_visit.discharge_date;
  END IF;
  IF v_visit.admission_date IS NOT NULL AND v_visit.admission_date <= CURRENT_DATE THEN
    RETURN v_visit.admission_date;
  END IF;

  -- The discharge date written on the bill, same test.
  v_try := public.parse_bill_date(p_discharge_text);
  IF v_try IS NOT NULL AND v_try <= CURRENT_DATE THEN
    RETURN v_try;
  END IF;

  RETURN CURRENT_DATE;
END;
$$;

COMMENT ON FUNCTION public.yojna_voucher_date(TEXT, TEXT, TEXT) IS
  'Date for a Yojna accrual. The invoice date when it is readable and not in '
  'the future, otherwise the visit discharge or admission date, which are real '
  'DATE columns and cannot be misread.';

-- The accrual again, dated through the resolver.
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
    public.yojna_voucher_date(NEW.date_of_invoice::TEXT,
                              NEW.date_of_discharge::TEXT,
                              NEW.visit_id),
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

-- Re-date any Yojna voucher already posted, so the parser and the books agree.
UPDATE public.vouchers v
   SET voucher_date = c.correct_date,
       last_modified_by = 'yojna-date-from-visit',
       updated_at = now()
  FROM (
    SELECT 'YOJNA-' || y.id::TEXT AS reference,
           public.yojna_voucher_date(y.date_of_invoice::TEXT,
                                     y.date_of_discharge::TEXT,
                                     y.visit_id) AS correct_date
      FROM public.yojna_bills y
  ) c
 WHERE v.reference_number = c.reference
   AND c.correct_date IS NOT NULL
   AND v.voucher_date IS DISTINCT FROM c.correct_date;
