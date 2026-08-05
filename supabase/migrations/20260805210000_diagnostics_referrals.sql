-- Outsourced diagnostics ("Diagnostics Chetna Nisha" tablet tiles).
--
-- When a patient is sent to an outside CT/MRI centre (most commonly Noble
-- Scan Center) or a blood test goes to an outsourced lab, the referral is
-- recorded BEFORE any money moves:
--
--   * a master of diagnostic centres and their test rates drives a dropdown
--     and the amount;
--   * approving a referral raises the centre's invoice on the hospital as an
--     expense bill — its existing trigger posts the JV
--     (Dr Diagnostic & Investigation Charges / Cr <the centre>);
--   * the bill sits outstanding on the Expense Bill page; when the online
--     payment is made later, record_expense_bill_payment generates the
--     payment voucher, as it does for every other supplier invoice;
--   * the requisition and invoice are printed from the tablet and the bill
--     row is viewable against the JV.
--
-- Two tiles use this: Nisha's posts on DRM Hope, Chetna's on Ayushman.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Masters
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.diagnostic_centres (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnostic_centres_name
  ON public.diagnostic_centres (lower(btrim(name))) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.diagnostic_centre_tests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id  UUID NOT NULL REFERENCES public.diagnostic_centres(id) ON DELETE CASCADE,
  test_name  TEXT NOT NULL,
  amount     NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnostic_centre_tests
  ON public.diagnostic_centre_tests (centre_id, lower(btrim(test_name))) WHERE is_active;

DROP TRIGGER IF EXISTS update_diagnostic_centres_updated_at ON public.diagnostic_centres;
CREATE TRIGGER update_diagnostic_centres_updated_at
  BEFORE UPDATE ON public.diagnostic_centres
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_diagnostic_centre_tests_updated_at ON public.diagnostic_centre_tests;
CREATE TRIGGER update_diagnostic_centre_tests_updated_at
  BEFORE UPDATE ON public.diagnostic_centre_tests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The one everyone uses.
INSERT INTO public.diagnostic_centres (name)
SELECT 'Noble Scan Center'
WHERE NOT EXISTS (
  SELECT 1 FROM public.diagnostic_centres
   WHERE lower(btrim(name)) = 'noble scan center' AND is_active
);

-- ------------------------------------------------------------------
-- 2. The referral register
-- ------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.diagnostic_invoice_seq;

CREATE TABLE IF NOT EXISTS public.diagnostic_referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_type   TEXT NOT NULL CHECK (hospital_type IN ('hope', 'ayushman')),
  company_id      UUID REFERENCES public.companies(id),
  centre_id       UUID NOT NULL REFERENCES public.diagnostic_centres(id),
  centre_name     TEXT NOT NULL,
  patient_id      UUID REFERENCES public.patients(id),
  patient_name    TEXT NOT NULL,
  patient_type    TEXT NOT NULL CHECK (patient_type IN ('OPD', 'IPD')),
  tests           JSONB NOT NULL,
  amount          NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  expense_bill_id UUID REFERENCES public.expense_bills(id),
  bill_number     TEXT,
  approved_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_referrals_created_at
  ON public.diagnostic_referrals (created_at DESC);

ALTER TABLE public.diagnostic_centres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_centre_tests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_referrals     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on diagnostic_centres" ON public.diagnostic_centres;
CREATE POLICY "Allow all operations on diagnostic_centres"
  ON public.diagnostic_centres FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all operations on diagnostic_centre_tests" ON public.diagnostic_centre_tests;
CREATE POLICY "Allow all operations on diagnostic_centre_tests"
  ON public.diagnostic_centre_tests FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all operations on diagnostic_referrals" ON public.diagnostic_referrals;
CREATE POLICY "Allow all operations on diagnostic_referrals"
  ON public.diagnostic_referrals FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------
-- 3. Approve a referral: invoice + JV in one call
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_diagnostic_referral(
  p_centre_id     UUID,
  p_patient_id    UUID,
  p_patient_name  TEXT,
  p_patient_type  TEXT,
  p_test_ids      UUID[],
  p_hospital_type TEXT,
  p_approved_by   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_centre       RECORD;
  v_hosp_key     TEXT;
  v_company      UUID;
  v_tests        JSONB;
  v_amount       NUMERIC;
  v_party        UUID;
  v_expense      UUID;
  v_code         TEXT;
  v_bill_no      TEXT;
  v_bill_id      UUID;
  v_referral_id  UUID;
  v_narr         TEXT;
  v_test_names   TEXT;
  v_user         TEXT := COALESCE(NULLIF(btrim(p_approved_by), ''), 'diagnostics-referral');
BEGIN
  IF COALESCE(btrim(p_patient_name), '') = '' THEN
    RAISE EXCEPTION 'The patient is missing';
  END IF;
  IF upper(COALESCE(p_patient_type, '')) NOT IN ('OPD', 'IPD') THEN
    RAISE EXCEPTION 'Choose whether the patient is OPD or IPD';
  END IF;
  IF p_test_ids IS NULL OR array_length(p_test_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one test';
  END IF;

  SELECT id, btrim(name) AS name INTO v_centre
    FROM public.diagnostic_centres WHERE id = p_centre_id AND is_active;
  IF v_centre.id IS NULL THEN
    RAISE EXCEPTION 'Pick the diagnostic centre';
  END IF;

  -- Amounts come from the master, never from the client.
  SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.test_name, 'amount', t.amount)),
         COALESCE(sum(t.amount), 0),
         string_agg(t.test_name, ', ')
    INTO v_tests, v_amount, v_test_names
    FROM public.diagnostic_centre_tests t
   WHERE t.id = ANY (p_test_ids) AND t.centre_id = v_centre.id AND t.is_active;
  IF v_tests IS NULL OR jsonb_array_length(v_tests) <> array_length(p_test_ids, 1) THEN
    RAISE EXCEPTION 'One of the picked tests is not in the master for %', v_centre.name;
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'The master has no amount for the picked tests — set it in the Diagnostic Centre Master';
  END IF;

  v_hosp_key := CASE WHEN lower(COALESCE(p_hospital_type, '')) = 'ayushman'
                     THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  SELECT id INTO v_company FROM public.companies WHERE company_key = v_hosp_key;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Accounting company for hospital "%" is not configured', p_hospital_type;
  END IF;

  -- The centre's creditor ledger in the hospital's books, created on first
  -- use. Matched with the books' punctuation-insensitive normalization.
  SELECT id INTO v_party
    FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
       = lower(btrim(regexp_replace(v_centre.name, '[^a-zA-Z0-9]+', ' ', 'g')))
   ORDER BY created_at
   LIMIT 1;
  IF v_party IS NULL THEN
    v_code := 'DIAG' || upper(substr(md5(v_company::text || lower(v_centre.name)), 1, 8));
    BEGIN
      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group, company_id,
         opening_balance, opening_balance_type, is_active)
      VALUES
        (v_code, v_centre.name, 'CURRENT_LIABILITIES', 'Sundry Creditors', v_company, 0, 'CR', true)
      ON CONFLICT (account_code) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    SELECT id INTO v_party
      FROM public.chart_of_accounts
     WHERE company_id = v_company AND is_active
       AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
         = lower(btrim(regexp_replace(v_centre.name, '[^a-zA-Z0-9]+', ' ', 'g')))
     ORDER BY created_at
     LIMIT 1;
    IF v_party IS NULL THEN
      RAISE EXCEPTION 'Could not create a ledger for %', v_centre.name;
    END IF;
  END IF;

  -- The expense ledger, one per company.
  SELECT id INTO v_expense
    FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
       = 'diagnostic investigation charges'
   ORDER BY created_at
   LIMIT 1;
  IF v_expense IS NULL THEN
    v_code := 'DGEX' || upper(substr(md5(v_company::text || 'diagnostic-investigation-charges'), 1, 8));
    BEGIN
      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group, company_id,
         opening_balance, opening_balance_type, is_active)
      VALUES
        (v_code, 'Diagnostic & Investigation Charges', 'DIRECT_EXPENSES', 'Direct Expenses',
         v_company, 0, 'DR', true)
      ON CONFLICT (account_code) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    SELECT id INTO v_expense
      FROM public.chart_of_accounts
     WHERE company_id = v_company AND is_active
       AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
         = 'diagnostic investigation charges'
     ORDER BY created_at
     LIMIT 1;
    IF v_expense IS NULL THEN
      RAISE EXCEPTION 'Could not create the Diagnostic & Investigation Charges ledger';
    END IF;
  END IF;

  -- The centre's invoice on the hospital. Its trigger posts the JV
  -- (Dr Diagnostic & Investigation Charges / Cr the centre); payment later
  -- from the Expense Bill page generates the payment voucher.
  v_bill_no := 'DIAG-' || nextval('public.diagnostic_invoice_seq')::TEXT;
  v_narr := 'Diagnostics — ' || btrim(p_patient_name) || ' (' || upper(p_patient_type)
         || '), ' || v_test_names || ' at ' || v_centre.name;
  INSERT INTO public.expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    narration, company_id, status, created_by, patient_name, patient_type
  ) VALUES (
    v_bill_no, CURRENT_DATE, v_party, v_expense, v_amount,
    v_narr, v_company, 'POSTED', v_user, btrim(p_patient_name), upper(p_patient_type)
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.diagnostic_referrals (
    hospital_type, company_id, centre_id, centre_name, patient_id, patient_name,
    patient_type, tests, amount, expense_bill_id, bill_number, approved_by
  ) VALUES (
    lower(p_hospital_type), v_company, v_centre.id, v_centre.name, p_patient_id,
    btrim(p_patient_name), upper(p_patient_type), v_tests, v_amount,
    v_bill_id, v_bill_no, v_user
  ) RETURNING id INTO v_referral_id;

  RETURN jsonb_build_object(
    'referralId',    v_referral_id,
    'invoiceNumber', v_bill_no,
    'amount',        v_amount,
    'tests',         v_tests,
    'centreName',    v_centre.name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_diagnostic_referral(UUID, UUID, TEXT, TEXT, UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_diagnostic_referral(UUID, UUID, TEXT, TEXT, UUID[], TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 4. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_noble INT;
BEGIN
  SELECT count(*) INTO v_noble FROM public.diagnostic_centres
   WHERE lower(btrim(name)) = 'noble scan center' AND is_active;
  IF v_noble <> 1 THEN
    RAISE EXCEPTION 'Noble Scan Center is not seeded (found %)', v_noble;
  END IF;

  BEGIN
    PERFORM public.record_diagnostic_referral(
      '00000000-0000-0000-0000-000000000001'::uuid,
      NULL, 'X', 'WARD', ARRAY['00000000-0000-0000-0000-000000000001'::uuid], 'hope', 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%OPD or IPD%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK — Noble seeded, record_diagnostic_referral guards hold';
  END;
END;
$verify$;

COMMIT;
