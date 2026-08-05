-- Rupali register entries post to accounting.
--
-- A submission on the tablet Rupali tile is a real transaction: the hospital
-- owes the doctor a fee for that IPD visit / OPD consultation / procedure /
-- day-care attendance. Saving now raises a Journal Voucher in the patient
-- company's books:
--
--     Dr  Consultation & Visit Charges          (Direct Expenses)
--     Cr  <the doctor's own Consultant ledger>  (Current Liabilities)
--
-- exactly the shape surgery invoices already use ("Surgeon Fees" JVs). The
-- doctor's ledger accumulates what they are owed; the existing payment
-- voucher flows settle it later. The JV shows in the Day Book as AUTO.
--
-- Doctor ledgers resolve through doctor_ledger_map (as the OT screen does),
-- then by name in the chart, and are created under the Consultant group when
-- missing — and written back to the map so every later entry reuses them.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ------------------------------------------------------------------
-- 1. The register row remembers the voucher it raised
-- ------------------------------------------------------------------
ALTER TABLE public.rupali_visit_logs
  ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES public.vouchers(id);

-- ------------------------------------------------------------------
-- 2. Post a visit: log row + JV, atomically
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_rupali_visit(
  p_category      TEXT,
  p_doctor_id     UUID,
  p_doctor_name   TEXT,
  p_patient_id    UUID,
  p_patient_name  TEXT,
  p_purpose       TEXT,
  p_amount        NUMERIC,
  p_hospital_type TEXT,
  p_created_by    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id   UUID;
  v_company_name TEXT;
  v_doctor_name  TEXT := btrim(p_doctor_name);
  v_party_id     UUID;
  v_expense_id   UUID;
  v_code         TEXT;
  v_type_id      UUID;
  v_type_code    TEXT;
  v_voucher_id   UUID := gen_random_uuid();
  v_voucher_no   TEXT;
  v_narration    TEXT;
  v_log_id       UUID;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Enter a valid amount';
  END IF;
  IF v_doctor_name = '' THEN
    RAISE EXCEPTION 'The doctor is missing';
  END IF;
  IF COALESCE(btrim(p_patient_name), '') = '' THEN
    RAISE EXCEPTION 'The patient is missing';
  END IF;

  -- The company follows the hospital the entry was made in.
  SELECT id, company_name INTO v_company_id, v_company_name
    FROM public.companies
   WHERE company_key = CASE WHEN lower(COALESCE(p_hospital_type, '')) = 'ayushman'
                            THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Accounting company for hospital "%" is not configured', p_hospital_type;
  END IF;

  -- ---- The doctor's party ledger ----
  SELECT m.party_account_id INTO v_party_id
    FROM public.doctor_ledger_map m
    JOIN public.chart_of_accounts a ON a.id = m.party_account_id AND a.is_active
   WHERE lower(m.surgeon_name) = lower(v_doctor_name)
     AND m.company_id = v_company_id;

  IF v_party_id IS NULL THEN
    SELECT id INTO v_party_id
      FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND is_active
       AND lower(btrim(account_name)) = lower(v_doctor_name)
     ORDER BY created_at
     LIMIT 1;
  END IF;

  IF v_party_id IS NULL THEN
    v_code := 'CONS' || upper(substr(md5(v_company_id::text || lower(v_doctor_name)), 1, 8));
    INSERT INTO public.chart_of_accounts
      (account_code, account_name, account_type, account_group, company_id,
       is_active, opening_balance, opening_balance_type)
    VALUES
      (v_code, v_doctor_name, 'CURRENT_LIABILITIES', 'Consultant', v_company_id, true, 0, 'CR')
    ON CONFLICT (account_code) DO NOTHING;
    SELECT id INTO v_party_id FROM public.chart_of_accounts WHERE account_code = v_code;
    IF v_party_id IS NULL THEN
      RAISE EXCEPTION 'Could not create a ledger for %', v_doctor_name;
    END IF;
  END IF;

  -- Remember the mapping so OT invoices and future visits reuse this ledger.
  INSERT INTO public.doctor_ledger_map (surgeon_name, company_id, party_account_id)
  VALUES (v_doctor_name, v_company_id, v_party_id)
  ON CONFLICT ((lower(surgeon_name))) DO NOTHING;

  -- ---- The expense ledger, shaped like Surgeon Fees ----
  SELECT id INTO v_expense_id
    FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND is_active
     AND lower(btrim(account_name)) = lower('Consultation & Visit Charges')
   ORDER BY created_at
   LIMIT 1;
  IF v_expense_id IS NULL THEN
    v_code := 'CVCH' || upper(substr(md5(v_company_id::text || 'consultation-visit-charges'), 1, 8));
    INSERT INTO public.chart_of_accounts
      (account_code, account_name, account_type, account_group, company_id,
       is_active, opening_balance, opening_balance_type)
    VALUES
      (v_code, 'Consultation & Visit Charges', 'DIRECT_EXPENSES', 'Direct Expenses',
       v_company_id, true, 0, 'DR')
    ON CONFLICT (account_code) DO NOTHING;
    SELECT id INTO v_expense_id FROM public.chart_of_accounts WHERE account_code = v_code;
    IF v_expense_id IS NULL THEN
      RAISE EXCEPTION 'Could not create the Consultation & Visit Charges ledger';
    END IF;
  END IF;

  -- ---- The Journal Voucher ----
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Journal voucher type is configured';
  END IF;

  v_voucher_no := public.generate_voucher_number(v_type_code);
  v_narration  := p_category || ' — ' || v_doctor_name || ' · ' || btrim(p_patient_name)
                  || CASE WHEN COALESCE(btrim(p_purpose), '') NOT IN ('', p_category)
                          THEN ' (' || btrim(p_purpose) || ')' ELSE '' END
                  || '. Rupali register.';

  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, narration, total_amount,
    patient_id, company_id, status, is_auto, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id, current_date, v_narration, p_amount,
    p_patient_id, v_company_id, 'AUTHORISED', true,
    coalesce(nullif(btrim(p_created_by), ''), 'rupali-register'), now(), now()
  );

  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_expense_id, v_narration, p_amount, 0, 1, now()),
    (gen_random_uuid(), v_voucher_id, v_party_id,   v_narration, 0, p_amount, 2, now());

  INSERT INTO public.rupali_visit_logs
    (category, doctor_id, doctor_name, patient_id, patient_name, purpose_reason,
     amount, created_by, voucher_id)
  VALUES
    (p_category, p_doctor_id, v_doctor_name, p_patient_id, btrim(p_patient_name),
     COALESCE(nullif(btrim(p_purpose), ''), p_category), p_amount, p_created_by, v_voucher_id)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'logId',         v_log_id,
    'voucherId',     v_voucher_id,
    'voucherNumber', v_voucher_no,
    'companyName',   v_company_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 3. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'rupali_visit_logs'
     AND column_name = 'voucher_id';
  IF v_cols <> 1 THEN
    RAISE EXCEPTION 'rupali_visit_logs.voucher_id is missing';
  END IF;

  -- The amount guard must be the first thing a bad call hits; the nested
  -- block rolls back anything the call might have touched.
  BEGIN
    PERFORM public.record_rupali_visit('OPD', NULL, 'X', NULL, 'Y', NULL, -1, 'hope', 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%valid amount%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK — record_rupali_visit guards hold: %', SQLERRM;
  END;
END;
$verify$;

COMMIT;
