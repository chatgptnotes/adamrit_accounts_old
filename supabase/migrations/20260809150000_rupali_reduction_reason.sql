-- A reduced payment to a consultant must be justified.
--
-- Rupali decides what a visit pays. When a patient cannot afford the full
-- charge the hospital may pay the doctor less than the standard — and when it
-- does, the register must record WHY and WHO allowed it, or the reduction is
-- invisible a month later and indistinguishable from a typo.
--
-- Three columns on the register, both required together whenever the amount
-- is below the category standard, enforced in record_rupali_visit AND in the
-- table's own trigger so no other writer can slip past it.
--
-- The locked-category rule is relaxed in exactly one direction: a locked
-- category (IPD, Rs. 1,000) previously admitted no other amount at all, which
-- made a concession impossible on the one category that most needs it. A
-- JUSTIFIED amount below the standard is now allowed; anything above it, and
-- any unjustified reduction, is still refused.
--
-- Safe to run twice. Applied through apply_migration(), which supplies the
-- transaction, so this file carries no BEGIN/COMMIT of its own.

-- ------------------------------------------------------------------
-- 1. The register remembers the standard it departed from
-- ------------------------------------------------------------------
ALTER TABLE public.rupali_visit_logs
  ADD COLUMN IF NOT EXISTS standard_amount       NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS reduction_reason      TEXT,
  ADD COLUMN IF NOT EXISTS reduction_approved_by TEXT;

-- ------------------------------------------------------------------
-- 2. The standard guard: locked means capped, not frozen
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_rupali_category_standard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_amount NUMERIC;
  v_locked BOOLEAN;
BEGIN
  SELECT amount, is_locked INTO v_amount, v_locked
    FROM public.rupali_category_defaults
   WHERE category = NEW.category;

  IF v_amount IS NULL THEN
    RETURN NEW;                       -- no standard for this category
  END IF;

  -- The charge master itself is unchanged: a locked category admits exactly
  -- the standard. Concessions belong on a visit, not on the rule.
  IF TG_TABLE_NAME = 'rupali_charge_rules' THEN
    IF COALESCE(v_locked, false) AND NEW.amount <> v_amount THEN
      RAISE EXCEPTION 'The standard % charge is Rs. % — % is not allowed',
        NEW.category, trim(to_char(v_amount, 'FM999999990')), trim(to_char(NEW.amount, 'FM999999990'));
    END IF;
    RETURN NEW;
  END IF;

  -- A visit may never pay MORE than a locked standard.
  IF COALESCE(v_locked, false) AND NEW.amount > v_amount THEN
    RAISE EXCEPTION 'The standard % charge is Rs. % — % is not allowed',
      NEW.category, trim(to_char(v_amount, 'FM999999990')), trim(to_char(NEW.amount, 'FM999999990'));
  END IF;

  -- Below the standard, locked or not, it must say why and who allowed it.
  IF NEW.amount < v_amount
     AND (NULLIF(btrim(COALESCE(NEW.reduction_reason, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(NEW.reduction_approved_by, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Paying Rs. % instead of the standard Rs. % needs a reason and the name of who approved it',
      trim(to_char(NEW.amount, 'FM999999990')), trim(to_char(v_amount, 'FM999999990'));
  END IF;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------
-- 3. record_rupali_visit carries the reason and the approver
--    (drop every existing signature so no ambiguous overload survives)
-- ------------------------------------------------------------------
DO $drop$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_rupali_visit'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END;
$drop$;


CREATE OR REPLACE FUNCTION public.record_rupali_visit(
  p_category      TEXT,
  p_doctor_id     UUID,
  p_doctor_name   TEXT,
  p_patient_id    UUID,
  p_patient_name  TEXT,
  p_purpose       TEXT,
  p_amount        NUMERIC,
  p_hospital_type TEXT,
  p_created_by    TEXT DEFAULT NULL,
  p_patient_category TEXT DEFAULT NULL,
  -- A payment below the standard needs both of these; see the guard below.
  p_reduction_reason      TEXT DEFAULT NULL,
  p_reduction_approved_by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_standard     NUMERIC;
  v_reason       TEXT := NULLIF(btrim(COALESCE(p_reduction_reason, '')), '');
  v_approver     TEXT := NULLIF(btrim(COALESCE(p_reduction_approved_by, '')), '');
  v_company_id   UUID;
  v_company_name TEXT;
  v_doctor_name  TEXT := btrim(p_doctor_name);
  v_doctor_norm  TEXT;
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

  -- A reduced payment must say why and who allowed it. The standard is the
  -- category's own; a category with no standard has nothing to reduce from.
  SELECT amount INTO v_standard
    FROM public.rupali_category_defaults WHERE category = p_category;
  IF v_standard IS NOT NULL AND p_amount < v_standard THEN
    IF v_reason IS NULL OR v_approver IS NULL THEN
      RAISE EXCEPTION 'Paying Rs. % instead of the standard Rs. % needs a reason and the name of who approved it',
        trim(to_char(p_amount, 'FM999999990')), trim(to_char(v_standard, 'FM999999990'));
    END IF;
  END IF;
  IF v_doctor_name = '' THEN
    RAISE EXCEPTION 'The doctor is missing';
  END IF;
  IF COALESCE(btrim(p_patient_name), '') = '' THEN
    RAISE EXCEPTION 'The patient is missing';
  END IF;

  v_doctor_norm := lower(btrim(regexp_replace(v_doctor_name, '[^a-zA-Z0-9]+', ' ', 'g')));

  SELECT id, company_name INTO v_company_id, v_company_name
    FROM public.companies
   WHERE company_key = CASE WHEN lower(COALESCE(p_hospital_type, '')) = 'ayushman'
                            THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Accounting company for hospital "%" is not configured', p_hospital_type;
  END IF;

  SELECT m.party_account_id INTO v_party_id
    FROM public.doctor_ledger_map m
    JOIN public.chart_of_accounts a ON a.id = m.party_account_id AND a.is_active
   WHERE lower(m.surgeon_name) = lower(v_doctor_name)
     AND m.company_id = v_company_id;

  IF v_party_id IS NULL THEN
    SELECT id INTO v_party_id
      FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND is_active
       AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = v_doctor_norm
     ORDER BY created_at
     LIMIT 1;
  END IF;

  IF v_party_id IS NULL THEN
    v_code := 'CONS' || upper(substr(md5(v_company_id::text || v_doctor_norm), 1, 8));
    BEGIN
      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group, company_id,
         is_active, opening_balance, opening_balance_type)
      VALUES
        (v_code, v_doctor_name, 'CURRENT_LIABILITIES', 'Consultant', v_company_id, true, 0, 'CR')
      ON CONFLICT (account_code) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    SELECT id INTO v_party_id
      FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND is_active
       AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = v_doctor_norm
     ORDER BY created_at
     LIMIT 1;
    IF v_party_id IS NULL THEN
      RAISE EXCEPTION 'Could not create a ledger for %', v_doctor_name;
    END IF;
  END IF;

  INSERT INTO public.doctor_ledger_map (surgeon_name, company_id, party_account_id)
  VALUES (v_doctor_name, v_company_id, v_party_id)
  ON CONFLICT ((lower(surgeon_name))) DO NOTHING;

  SELECT id INTO v_expense_id
    FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND is_active
     AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
       = 'consultation visit charges'
   ORDER BY created_at
   LIMIT 1;
  IF v_expense_id IS NULL THEN
    v_code := 'CVCH' || upper(substr(md5(v_company_id::text || 'consultation-visit-charges'), 1, 8));
    BEGIN
      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group, company_id,
         is_active, opening_balance, opening_balance_type)
      VALUES
        (v_code, 'Consultation & Visit Charges', 'DIRECT_EXPENSES', 'Direct Expenses',
         v_company_id, true, 0, 'DR')
      ON CONFLICT (account_code) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    SELECT id INTO v_expense_id
      FROM public.chart_of_accounts
     WHERE company_id = v_company_id AND is_active
       AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
         = 'consultation visit charges'
     ORDER BY created_at
     LIMIT 1;
    IF v_expense_id IS NULL THEN
      RAISE EXCEPTION 'Could not create the Consultation & Visit Charges ledger';
    END IF;
  END IF;

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
                  || CASE WHEN COALESCE(btrim(p_patient_category), '') NOT IN ('', 'Any')
                          THEN ' [' || btrim(p_patient_category) || ']' ELSE '' END
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
     patient_category, amount, created_by, voucher_id,
     standard_amount, reduction_reason, reduction_approved_by)
  VALUES
    (p_category, p_doctor_id, v_doctor_name, p_patient_id, btrim(p_patient_name),
     COALESCE(nullif(btrim(p_purpose), ''), p_category),
     NULLIF(btrim(COALESCE(p_patient_category, '')), ''),
     p_amount, p_created_by, v_voucher_id,
     v_standard, v_reason, v_approver)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'logId',         v_log_id,
    'voucherId',     v_voucher_id,
    'voucherNumber', v_voucher_no,
    'companyName',   v_company_name
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 4. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_overloads INT;
BEGIN
  SELECT count(*) INTO v_overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_rupali_visit';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'expected 1 record_rupali_visit, found %', v_overloads;
  END IF;

  -- An unjustified IPD concession is refused...
  BEGIN
    INSERT INTO public.rupali_visit_logs
      (category, doctor_name, patient_name, purpose_reason, amount, created_by)
    VALUES ('IPD', '__verify__', '__verify__', 'IPD', 750, 'migration-verify');
    RAISE EXCEPTION 'verification did not reach the justification guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%needs a reason and the name of who approved it%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
  END;

  -- ...a justified one goes through (discarded in its own subtransaction)...
  BEGIN
    INSERT INTO public.rupali_visit_logs
      (category, doctor_name, patient_name, purpose_reason, amount, created_by,
       reduction_reason, reduction_approved_by)
    VALUES ('IPD', '__verify__', '__verify__', 'IPD', 750, 'migration-verify',
            'patient could not afford it', 'Dr M');
    RAISE EXCEPTION 'discard-the-probe';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'discard-the-probe' THEN
        RAISE EXCEPTION 'a justified IPD concession was refused: %', SQLERRM;
      END IF;
  END;

  -- ...and paying ABOVE a locked standard is still refused, justified or not.
  BEGIN
    INSERT INTO public.rupali_visit_logs
      (category, doctor_name, patient_name, purpose_reason, amount, created_by,
       reduction_reason, reduction_approved_by)
    VALUES ('IPD', '__verify__', '__verify__', 'IPD', 1500, 'migration-verify',
            'trying it on', 'Dr M');
    RAISE EXCEPTION 'verification did not reach the locked-standard guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%is not allowed%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
  END;

  RAISE NOTICE 'OK — reductions need a reason and an approver; locked standards remain a ceiling';
END;
$verify$;
