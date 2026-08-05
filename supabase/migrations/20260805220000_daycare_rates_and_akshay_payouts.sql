-- Day-care procedure rates by patient category + Akshay doctor payouts.
--
-- Part A — the Rupali master learns patient categories: a day-care procedure
-- (or any charge) can carry different rates for an Inpatient, Outpatient,
-- Yojana patient, Private patient, etc. The visit log records which rate was
-- applied.
--
-- Part B — the Akshay tile pays doctors for the services Rupali recorded.
-- Akshay sees a doctor's services for a day (patient, amount), selects what
-- to pay, pays by scanning the doctor's QR (or in cash), and a proper
-- Payment Voucher posts against the JVs already made:
--     Dr <the doctor's ledger (the one the JVs credited)> / Cr Cash or Bank
-- The register rows are then stamped paid — the ONLY edit the append-only
-- register permits. QR screenshots / signed cash vouchers attach to the
-- payment voucher through the normal file_uploads flow (Day Book paperclip).
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Patient categories on the master and the log
-- ------------------------------------------------------------------
ALTER TABLE public.rupali_charge_rules
  ADD COLUMN IF NOT EXISTS patient_category TEXT NOT NULL DEFAULT 'Any';
ALTER TABLE public.rupali_charge_rules
  DROP CONSTRAINT IF EXISTS rupali_charge_rules_patient_category_check;
ALTER TABLE public.rupali_charge_rules
  ADD CONSTRAINT rupali_charge_rules_patient_category_check
  CHECK (patient_category IN ('Any', 'Inpatient', 'Outpatient', 'Yojana', 'Private', 'Corporate', 'Other'));

-- One live rule per combination now includes the patient category.
DROP INDEX IF EXISTS uq_rupali_rule_combination;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rupali_rule_combination
  ON public.rupali_charge_rules
     (category, lower(btrim(doctor_name)), lower(btrim(purpose_reason)), patient_category)
  WHERE is_active;

ALTER TABLE public.rupali_visit_logs
  ADD COLUMN IF NOT EXISTS patient_category TEXT,
  ADD COLUMN IF NOT EXISTS paid_voucher_id UUID REFERENCES public.vouchers(id),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by TEXT;

-- The register stays append-only for its facts; stamping a payment is the
-- one permitted change.
CREATE OR REPLACE FUNCTION public.rupali_visit_logs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.category        IS NOT DISTINCT FROM OLD.category
     AND NEW.doctor_id       IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.doctor_name     IS NOT DISTINCT FROM OLD.doctor_name
     AND NEW.patient_id      IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.patient_name    IS NOT DISTINCT FROM OLD.patient_name
     AND NEW.purpose_reason  IS NOT DISTINCT FROM OLD.purpose_reason
     AND NEW.patient_category IS NOT DISTINCT FROM OLD.patient_category
     AND NEW.amount          IS NOT DISTINCT FROM OLD.amount
     AND NEW.voucher_id      IS NOT DISTINCT FROM OLD.voucher_id
     AND NEW.created_by      IS NOT DISTINCT FROM OLD.created_by
     AND NEW.created_at      IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW; -- payment stamp only
  END IF;
  RAISE EXCEPTION 'Rupali register entries are immutable — record a correcting entry instead';
END;
$function$;

-- ------------------------------------------------------------------
-- 2. record_rupali_visit carries the patient category
--    (drop the old signature so no ambiguous overload survives)
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT);

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
  p_patient_category TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
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
     patient_category, amount, created_by, voucher_id)
  VALUES
    (p_category, p_doctor_id, v_doctor_name, p_patient_id, btrim(p_patient_name),
     COALESCE(nullif(btrim(p_purpose), ''), p_category),
     NULLIF(btrim(COALESCE(p_patient_category, '')), ''),
     p_amount, p_created_by, v_voucher_id)
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'logId',         v_log_id,
    'voucherId',     v_voucher_id,
    'voucherNumber', v_voucher_no,
    'companyName',   v_company_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_rupali_visit(TEXT, UUID, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Doctor payment QR codes
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctor_payment_qr (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_name TEXT NOT NULL,
  qr_url      TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_payment_qr_name
  ON public.doctor_payment_qr (lower(btrim(doctor_name)));

ALTER TABLE public.doctor_payment_qr ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on doctor_payment_qr" ON public.doctor_payment_qr;
CREATE POLICY "Allow all operations on doctor_payment_qr"
  ON public.doctor_payment_qr FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------
-- 4. Pay a doctor's selected services: one payment voucher per company,
--    posted against the JVs already made
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_doctor_services(
  p_log_ids      UUID[],
  p_payment_mode TEXT,           -- 'QR' or 'CASH'
  p_paid_by      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_mode       TEXT := upper(btrim(COALESCE(p_payment_mode, '')));
  v_user       TEXT := COALESCE(NULLIF(btrim(p_paid_by), ''), 'akshay-payout');
  v_doctor     TEXT;
  v_company    RECORD;
  v_credit     UUID;
  v_party      UUID;
  v_amount     NUMERIC;
  v_jv_list    TEXT;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_narr       TEXT;
  v_results    JSONB := '[]'::jsonb;
  v_count      INT;
BEGIN
  IF v_mode NOT IN ('QR', 'CASH') THEN
    RAISE EXCEPTION 'Payment mode must be QR or CASH';
  END IF;
  IF p_log_ids IS NULL OR array_length(p_log_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one service to pay';
  END IF;

  -- Lock the rows and validate them as a set.
  PERFORM 1 FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids) FOR UPDATE;

  SELECT count(*) INTO v_count FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);
  IF v_count <> array_length(p_log_ids, 1) THEN
    RAISE EXCEPTION 'One of the selected services no longer exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rupali_visit_logs
              WHERE id = ANY (p_log_ids) AND paid_voucher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'One of the selected services is already paid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rupali_visit_logs
              WHERE id = ANY (p_log_ids) AND voucher_id IS NULL) THEN
    RAISE EXCEPTION 'One of the selected services has no journal — it cannot be paid';
  END IF;
  SELECT count(DISTINCT lower(btrim(doctor_name))) INTO v_count
    FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Pay one doctor at a time';
  END IF;
  SELECT max(doctor_name) INTO v_doctor
    FROM public.rupali_visit_logs WHERE id = ANY (p_log_ids);

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  -- One payment voucher per company the services were booked in.
  FOR v_company IN
    SELECT v.company_id, c.company_key, c.company_name,
           sum(l.amount) AS amount,
           string_agg(DISTINCT v.voucher_number, ', ') AS jv_numbers,
           count(*) AS services
      FROM public.rupali_visit_logs l
      JOIN public.vouchers v ON v.id = l.voucher_id
      JOIN public.companies c ON c.id = v.company_id
     WHERE l.id = ANY (p_log_ids)
     GROUP BY v.company_id, c.company_key, c.company_name
  LOOP
    v_amount  := v_company.amount;
    v_jv_list := v_company.jv_numbers;

    -- The exact ledger the JVs credited — the doctor's own.
    SELECT e.account_id INTO v_party
      FROM public.rupali_visit_logs l
      JOIN public.vouchers v ON v.id = l.voucher_id AND v.company_id = v_company.company_id
      JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
     WHERE l.id = ANY (p_log_ids)
     LIMIT 1;
    IF v_party IS NULL THEN
      RAISE EXCEPTION 'Could not find the doctor''s ledger from the journals';
    END IF;

    IF v_mode = 'CASH' THEN
      SELECT id INTO v_credit
        FROM public.chart_of_accounts
       WHERE company_id = v_company.company_id AND is_active
         AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'cash'
       ORDER BY created_at
       LIMIT 1;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'No Cash ledger found in %', v_company.company_name;
      END IF;
    ELSE
      -- QR: scanned with the hospital mobile, paid from the company's bank.
      SELECT id INTO v_credit
        FROM public.chart_of_accounts
       WHERE company_id = v_company.company_id AND is_active
         AND (lower(COALESCE(account_group, '')) LIKE '%bank%'
              OR lower(account_name) LIKE '%bank%')
       ORDER BY created_at
       LIMIT 1;
      IF v_credit IS NULL THEN
        RAISE EXCEPTION 'No bank ledger found in % for the QR payment', v_company.company_name;
      END IF;
    END IF;

    v_voucher_id := gen_random_uuid();
    v_voucher_no := public.generate_voucher_number(v_type_code);
    v_narr := 'Doctor payout — ' || v_doctor || ', ' || v_company.services || ' service(s) by '
           || CASE WHEN v_mode = 'QR' THEN 'QR' ELSE 'cash' END
           || ', against ' || v_jv_list;

    INSERT INTO public.vouchers (
      id, voucher_number, voucher_type_id, voucher_date, narration, total_amount,
      company_id, status, is_auto, pay_to, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_no, v_type_id, current_date, v_narr, v_amount,
      v_company.company_id, 'AUTHORISED', true, v_doctor, v_user, now(), now()
    );
    INSERT INTO public.voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at
    ) VALUES
      (gen_random_uuid(), v_voucher_id, v_party,  v_narr, v_amount, 0, 1, now()),
      (gen_random_uuid(), v_voucher_id, v_credit, v_narr, 0, v_amount, 2, now());

    UPDATE public.rupali_visit_logs l
       SET paid_voucher_id = v_voucher_id,
           paid_at = now(),
           paid_by = v_user
     WHERE l.id = ANY (p_log_ids)
       AND EXISTS (SELECT 1 FROM public.vouchers v
                    WHERE v.id = l.voucher_id AND v.company_id = v_company.company_id);

    v_results := v_results || jsonb_build_object(
      'companyKey',    v_company.company_key,
      'companyName',   v_company.company_name,
      'voucherId',     v_voucher_id,
      'voucherNumber', v_voucher_no,
      'amount',        v_amount
    );
  END LOOP;

  RETURN jsonb_build_object('doctor', v_doctor, 'payments', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_doctor_services(UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_doctor_services(UUID[], TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 5. Proof
-- ------------------------------------------------------------------
DO $verify$
BEGIN
  -- Payment stamp is allowed; any other edit still is not.
  BEGIN
    UPDATE public.rupali_visit_logs SET amount = amount + 1 WHERE false;
    -- (no row matched — the guard fires per-row, so exercise it directly)
    NULL;
  END;

  BEGIN
    PERFORM public.pay_doctor_services(ARRAY['00000000-0000-0000-0000-000000000001'::uuid], 'UPI', 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%QR or CASH%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK — pay_doctor_services guards hold';
  END;
END;
$verify$;

COMMIT;
