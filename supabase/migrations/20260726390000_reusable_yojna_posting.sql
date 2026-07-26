-- Make the Yojna posting callable, so the backfill and the trigger cannot
-- drift apart.
--
-- Same reasoning as the payment vouchers: a backfill that repeats the posting
-- logic is two copies of one rule, and copies drift. So the body moves into
-- post_one_yojna_bill(id) and the trigger becomes the part that decides when to
-- call it - the no-change check and the cancel-on-edit stay in the trigger,
-- because they are about editing, not about posting.
--
-- Behaviour is unchanged: same voucher, same legs, same guards, same date
-- resolver.

CREATE OR REPLACE FUNCTION public.post_one_yojna_bill(p_bill_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  y            RECORD;
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
  SELECT * INTO y FROM yojna_bills WHERE id = p_bill_id;
  IF y.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_reference := 'YOJNA-' || y.id::TEXT;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NULL;
  END IF;

  v_amount := GREATEST(COALESCE(y.total_amount, 0), 0);
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- If a final bill for this visit has already accrued, the episode is in the
  -- books. Posting the claim as well would count it twice.
  IF EXISTS (
    SELECT 1
      FROM bills b
      JOIN vouchers vv ON vv.bill_id = b.id AND vv.status <> 'CANCELLED'
     WHERE b.visit_id = y.visit_id
  ) THEN
    RAISE WARNING 'Visit %: final bill already accrued, Yojna bill % not posted',
      y.visit_id, y.invoice_no;
    RETURN NULL;
  END IF;

  SELECT p.id, p.patients_id, p.hospital_name, p.name AS patient_name
    INTO v_patient
    FROM visits v
    JOIN patients p ON p.id = v.patient_id
   WHERE v.visit_id = y.visit_id
   LIMIT 1;

  -- The scheme carries the claim, through the same corporate.ledger_account_id
  -- the payer split uses.
  SELECT c.ledger_account_id INTO v_debtor_id
    FROM corporate c
   WHERE lower(btrim(c.name)) = lower(btrim(COALESCE(y.corporate_name, '')))
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
      y.invoice_no, y.corporate_name;
  END IF;

  SELECT id INTO v_income_id FROM chart_of_accounts WHERE account_code = '4160';
  v_company_id := public.resolve_patient_company(
                    COALESCE(y.hospital_name, v_patient.hospital_name),
                    y.corporate_name);

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'SALES' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'SV' THEN 1 WHEN 'SAL' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL OR v_debtor_id IS NULL OR v_income_id IS NULL THEN
    RAISE WARNING 'Yojna bill %: ledgers or voucher type missing, nothing accrued',
      y.invoice_no;
    RETURN NULL;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := 'Yojna claim ' || COALESCE(NULLIF(btrim(y.invoice_no), ''), v_reference)
                  || COALESCE(' - ' || NULLIF(btrim(y.corporate_name), ''), '')
                  || COALESCE(' - ' || NULLIF(btrim(COALESCE(y.patient_name,
                                                             v_patient.patient_name)), ''), '');

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    public.yojna_voucher_date(y.date_of_invoice::TEXT, y.date_of_discharge::TEXT, y.visit_id),
    v_reference, v_narration, v_amount, v_company_id, 'AUTHORISED',
    COALESCE(y.created_by::TEXT, 'yojna-bill'), NOW(), NOW()
  );

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, patient_ledger_id, narration,
    debit_amount, credit_amount, entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor_id, v_ledger_pid,
     v_narration, v_amount, 0, 1, NOW()),
    (gen_random_uuid(), v_voucher_id, v_income_id, NULL,
     v_narration, 0, v_amount, 2, NOW());

  RETURN v_voucher_no;
END;
$$;

-- The trigger keeps only what is about editing, and calls the posting.
CREATE OR REPLACE FUNCTION public.accrue_yojna_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A save that changes nothing the ledger cares about is not a correction.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.total_amount, 0) = COALESCE(OLD.total_amount, 0)
     AND lower(btrim(COALESCE(NEW.corporate_name, ''))) = lower(btrim(COALESCE(OLD.corporate_name, '')))
     AND NEW.date_of_invoice IS NOT DISTINCT FROM OLD.date_of_invoice THEN
    RETURN NEW;
  END IF;

  -- Anything that does change retires the earlier posting before reposting.
  IF TG_OP = 'UPDATE' THEN
    UPDATE vouchers
       SET status = 'CANCELLED',
           last_modified_by = 'yojna-bill-edited',
           updated_at = now()
     WHERE reference_number = 'YOJNA-' || NEW.id::TEXT AND status <> 'CANCELLED';
  END IF;

  PERFORM public.post_one_yojna_bill(NEW.id);
  RETURN NEW;
END;
$$;
