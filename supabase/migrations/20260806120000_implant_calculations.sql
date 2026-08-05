-- Implant calculation (Azhar): discharged-patient cut decisions + calc sheets.
--
-- Azhar reviews every discharged IPD patient of both hospitals, decides
-- direct vs referred and the cut, photographs his handwritten calculation,
-- and approves. A referred approval posts through the same M.L. Enterprises
-- implant mechanism as the revenue-report cuts; the photo becomes the
-- invoice's document. One decision per visit — no double claim.
--
-- Also: the Director Dashboard's IPD Daily Revenue Report gains per-row
-- calculation-sheet uploads (revenue_calc_sheets), taken before Approve.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- Sheets uploaded against Daily Revenue Report rows (keyed by the row's key).
CREATE TABLE IF NOT EXISTS public.revenue_calc_sheets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_key     TEXT NOT NULL,
  report_date DATE NOT NULL,
  url         TEXT NOT NULL,
  path        TEXT,
  uploaded_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revenue_calc_sheets_date
  ON public.revenue_calc_sheets (report_date, row_key);
ALTER TABLE public.revenue_calc_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on revenue_calc_sheets" ON public.revenue_calc_sheets;
CREATE POLICY "Allow all operations on revenue_calc_sheets"
  ON public.revenue_calc_sheets FOR ALL USING (true) WITH CHECK (true);

-- One settlement decision per discharged visit.
CREATE TABLE IF NOT EXISTS public.implant_calculations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_uuid        UUID NOT NULL UNIQUE REFERENCES public.visits(id),
  visit_code        TEXT,
  patient_name      TEXT NOT NULL,
  hospital_type     TEXT NOT NULL CHECK (hospital_type IN ('hope', 'ayushman')),
  referee_name      TEXT,
  decision          TEXT NOT NULL CHECK (decision IN ('DIRECT', 'REFERRED')),
  cut_amount        NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (cut_amount >= 0),
  calc_sheets       JSONB NOT NULL DEFAULT '[]'::jsonb,
  expense_bill_id   UUID REFERENCES public.expense_bills(id),
  ml_invoice_number TEXT,
  approved_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_implant_calculations_created_at
  ON public.implant_calculations (created_at DESC);
ALTER TABLE public.implant_calculations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on implant_calculations" ON public.implant_calculations;
CREATE POLICY "Allow all operations on implant_calculations"
  ON public.implant_calculations FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.record_implant_calculation(
  p_visit_uuid   UUID,
  p_decision     TEXT,
  p_cut_amount   NUMERIC,
  p_referee_name TEXT,
  p_calc_sheets  JSONB DEFAULT '[]'::jsonb,
  p_approved_by  TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_visit        RECORD;
  v_hosp_type    TEXT;
  v_hosp_key     TEXT;
  v_hosp_company UUID;
  v_ml_company   UUID;
  v_party UUID; v_expense UUID; v_debtor UUID; v_sales UUID; v_comm UUID; v_rm UUID;
  v_referee      TEXT := btrim(COALESCE(p_referee_name, ''));
  v_bill_no      TEXT;
  v_bill_id      UUID;
  v_type_id UUID; v_type_code TEXT; v_voucher_id UUID;
  v_sales_vno TEXT; v_comm_vno TEXT; v_narr TEXT;
  v_doc_url TEXT; v_doc_path TEXT;
  v_row_id       UUID;
  v_user         TEXT := COALESCE(NULLIF(btrim(p_approved_by), ''), 'implant-calculation');
BEGIN
  IF upper(COALESCE(p_decision, '')) NOT IN ('DIRECT', 'REFERRED') THEN
    RAISE EXCEPTION 'Decide DIRECT or REFERRED';
  END IF;

  SELECT v.id, v.visit_id AS code, p.name AS patient_name, p.hospital_name
    INTO v_visit
    FROM public.visits v
    JOIN public.patients p ON p.id = v.patient_id
   WHERE v.id = p_visit_uuid;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Visit not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.implant_calculations WHERE visit_uuid = p_visit_uuid) THEN
    RAISE EXCEPTION 'This patient''s discharge is already settled';
  END IF;

  v_hosp_type := CASE WHEN lower(COALESCE(v_visit.hospital_name, '')) LIKE '%ayush%'
                      THEN 'ayushman' ELSE 'hope' END;

  IF upper(p_decision) = 'DIRECT' THEN
    INSERT INTO public.implant_calculations
      (visit_uuid, visit_code, patient_name, hospital_type, referee_name,
       decision, cut_amount, calc_sheets, approved_by)
    VALUES
      (p_visit_uuid, v_visit.code, v_visit.patient_name, v_hosp_type,
       NULLIF(v_referee, ''), 'DIRECT', 0, COALESCE(p_calc_sheets, '[]'::jsonb), v_user)
    RETURNING id INTO v_row_id;
    RETURN jsonb_build_object('id', v_row_id, 'decision', 'DIRECT');
  END IF;

  -- REFERRED: the cut passes on through M.L. Enterprises, like the DRR cuts.
  IF p_cut_amount IS NULL OR p_cut_amount <= 0 THEN
    RAISE EXCEPTION 'Enter the cut to pass on';
  END IF;
  IF v_referee = '' THEN
    RAISE EXCEPTION 'A referred patient needs the referee''s name';
  END IF;

  v_hosp_key := CASE WHEN v_hosp_type = 'ayushman' THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  SELECT id INTO v_hosp_company FROM public.companies WHERE company_key = v_hosp_key;
  SELECT id INTO v_ml_company   FROM public.companies WHERE company_key = 'ml_enterprises';
  IF v_hosp_company IS NULL OR v_ml_company IS NULL THEN
    RAISE EXCEPTION 'Run the M.L. Enterprises setup migration first';
  END IF;

  SELECT id INTO v_party FROM public.chart_of_accounts
   WHERE company_id = v_hosp_company AND is_active
     AND lower(btrim(account_name)) = 'm.l. enterprises' LIMIT 1;
  SELECT id INTO v_expense FROM public.chart_of_accounts
   WHERE (company_id = v_hosp_company OR company_id IS NULL) AND is_active
     AND lower(btrim(account_name)) = 'implant purchase'
     AND account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES')
   ORDER BY (company_id = v_hosp_company) DESC LIMIT 1;
  SELECT id INTO v_debtor FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active
     AND lower(btrim(account_name)) =
         CASE WHEN v_hosp_key = 'ayushman_nagpur' THEN 'ayushman hospital' ELSE 'hope hospital' END
   LIMIT 1;
  SELECT id INTO v_sales FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active AND lower(btrim(account_name)) = 'sales' LIMIT 1;
  SELECT id INTO v_comm FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active AND lower(btrim(account_name)) = 'referral commission' LIMIT 1;
  IF v_party IS NULL OR v_expense IS NULL OR v_debtor IS NULL OR v_sales IS NULL OR v_comm IS NULL THEN
    RAISE EXCEPTION 'The M.L. Enterprises ledgers are missing — run the setup migration';
  END IF;

  SELECT id INTO v_rm FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active
     AND lower(btrim(account_name)) = lower(v_referee) LIMIT 1;
  IF v_rm IS NULL THEN
    INSERT INTO public.chart_of_accounts
      (account_code, account_name, account_type, account_group, company_id,
       opening_balance, opening_balance_type, is_active)
    VALUES
      ('MLRM_' || lpad(nextval('public.ml_rm_ledger_seq')::TEXT, 6, '0'),
       v_referee, 'CURRENT_LIABILITIES', 'Sundry Creditors', v_ml_company, 0, 'CR', true)
    RETURNING id INTO v_rm;
  END IF;

  -- The handwritten calculation photo becomes the invoice's document.
  v_doc_url  := p_calc_sheets #>> '{0,url}';
  v_doc_path := p_calc_sheets #>> '{0,path}';

  v_bill_no := public.next_ml_invoice_number();
  v_narr := 'Implant purchase — ' || v_visit.patient_name || ' (IPD, RM ' || v_referee
         || ', discharge settlement)';
  INSERT INTO public.expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    narration, document_path, document_url, company_id, status, created_by,
    relationship_manager, patient_name, patient_type
  ) VALUES (
    v_bill_no, CURRENT_DATE, v_party, v_expense, p_cut_amount,
    v_narr, v_doc_path, v_doc_url, v_hosp_company, 'POSTED', v_user,
    v_referee, v_visit.patient_name, 'IPD'
  ) RETURNING id INTO v_bill_id;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active JOURNAL voucher type is configured';
  END IF;

  v_voucher_id := gen_random_uuid();
  v_sales_vno  := public.generate_voucher_number(v_type_code);
  v_narr := 'Sale of implant — ' || v_visit.patient_name || ', invoice ' || v_bill_no;
  INSERT INTO public.vouchers (id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at)
  VALUES (v_voucher_id, v_sales_vno, v_type_id, CURRENT_DATE, v_bill_no,
    v_narr, p_cut_amount, v_ml_company, 'AUTHORISED', v_user, NOW(), NOW());
  INSERT INTO public.voucher_entries (id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, bill_ref, created_at)
  VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor, v_narr, p_cut_amount, 0, 1, v_bill_no, NOW()),
    (gen_random_uuid(), v_voucher_id, v_sales,  v_narr, 0, p_cut_amount, 2, NULL, NOW());

  v_voucher_id := gen_random_uuid();
  v_comm_vno   := public.generate_voucher_number(v_type_code);
  v_narr := 'Referral commission ' || v_referee || ' — ' || v_visit.patient_name || ', invoice ' || v_bill_no;
  INSERT INTO public.vouchers (id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at)
  VALUES (v_voucher_id, v_comm_vno, v_type_id, CURRENT_DATE, v_bill_no,
    v_narr, p_cut_amount, v_ml_company, 'AUTHORISED', v_user, NOW(), NOW());
  INSERT INTO public.voucher_entries (id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, bill_ref, created_at)
  VALUES
    (gen_random_uuid(), v_voucher_id, v_comm, v_narr, p_cut_amount, 0, 1, NULL, NOW()),
    (gen_random_uuid(), v_voucher_id, v_rm,   v_narr, 0, p_cut_amount, 2, v_bill_no, NOW());

  INSERT INTO public.implant_calculations
    (visit_uuid, visit_code, patient_name, hospital_type, referee_name,
     decision, cut_amount, calc_sheets, expense_bill_id, ml_invoice_number, approved_by)
  VALUES
    (p_visit_uuid, v_visit.code, v_visit.patient_name, v_hosp_type, v_referee,
     'REFERRED', p_cut_amount, COALESCE(p_calc_sheets, '[]'::jsonb), v_bill_id, v_bill_no, v_user)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object(
    'id', v_row_id, 'decision', 'REFERRED', 'invoiceNumber', v_bill_no,
    'salesVoucher', v_sales_vno, 'commissionVoucher', v_comm_vno
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_implant_calculation(UUID, TEXT, NUMERIC, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_implant_calculation(UUID, TEXT, NUMERIC, TEXT, JSONB, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $verify$
BEGIN
  BEGIN
    PERFORM public.record_implant_calculation(
      '00000000-0000-0000-0000-000000000001'::uuid, 'MAYBE', 0, NULL, '[]'::jsonb, 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%DIRECT or REFERRED%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK — implant calculation tables + guards in place';
  END;
END;
$verify$;

COMMIT;
