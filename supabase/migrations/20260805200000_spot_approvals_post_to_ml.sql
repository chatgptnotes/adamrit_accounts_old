-- Spot approvals post through M.L. Enterprises, like every other referral cut.
--
-- The Director's implant-purchase mechanism (20260804150000) applies to the
-- on-the-spot admission commission too: approving a spot on the tablet now
-- posts, in one transaction —
--
--   Hospital books (DRM Hope / Ayushman):
--     expense_bills row -> its trigger posts  Dr Implant Purchase / Cr M.L. Enterprises
--   M.L. Enterprises books:
--     JV  Dr <Hope|Ayushman> Hospital (debtor) / Cr Sales
--     JV  Dr Referral Commission / Cr <the referee's ledger>
--
-- The amount is the approved "maximum spot" (5,000 default, 8,000 ceiling).
-- Nothing is paid at approval: the M.L. invoice sits outstanding on the
-- Expense Bill page and is paid later via record_expense_bill_payment —
-- the amount paid is the amount paid to M.L. Enterprises.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

ALTER TABLE public.spot_payment_approvals
  ADD COLUMN IF NOT EXISTS expense_bill_id UUID REFERENCES public.expense_bills(id),
  ADD COLUMN IF NOT EXISTS ml_invoice_number TEXT;

CREATE OR REPLACE FUNCTION public.record_spot_approval(
  p_referee_ledger_id  UUID,
  p_patient_id         UUID,
  p_patient_name       TEXT,
  p_visit_id           TEXT,
  p_deposit_paid       NUMERIC,
  p_deposit_to_collect NUMERIC,
  p_max_spot           NUMERIC,
  p_hospital_type      TEXT,
  p_approved_by        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_referee_name TEXT;
  v_hosp_key     TEXT;
  v_hosp_company UUID;
  v_ml_company   UUID;
  v_party        UUID;   -- M.L. Enterprises in the hospital's books
  v_expense      UUID;   -- Implant Purchase in the hospital's books
  v_debtor       UUID;   -- the hospital in ML's books
  v_sales        UUID;
  v_comm         UUID;
  v_rm_ledger    UUID;   -- the referee in ML's books
  v_bill_no      TEXT;
  v_bill_id      UUID;
  v_type_id      UUID;
  v_type_code    TEXT;
  v_voucher_id   UUID;
  v_sales_vno    TEXT;
  v_comm_vno     TEXT;
  v_narr         TEXT;
  v_approval_id  UUID;
  v_user         TEXT := COALESCE(NULLIF(btrim(p_approved_by), ''), 'spot-approval');
BEGIN
  IF p_max_spot IS NULL OR p_max_spot <= 0 OR p_max_spot > 8000 THEN
    RAISE EXCEPTION 'Maximum spot must be between 1 and 8,000';
  END IF;
  IF COALESCE(btrim(p_patient_name), '') = '' THEN
    RAISE EXCEPTION 'The patient is missing';
  END IF;
  IF p_deposit_to_collect IS NOT NULL AND p_deposit_to_collect < 0 THEN
    RAISE EXCEPTION 'The deposit to collect cannot be negative';
  END IF;

  SELECT btrim(account_name) INTO v_referee_name
    FROM public.chart_of_accounts
   WHERE id = p_referee_ledger_id AND is_active = true;
  IF v_referee_name IS NULL THEN
    RAISE EXCEPTION 'Pick the referee''s ledger';
  END IF;

  -- Which hospital owes the "implant" invoice.
  IF lower(COALESCE(p_hospital_type, '')) = 'ayushman' THEN
    v_hosp_key := 'ayushman_nagpur';
  ELSE
    v_hosp_key := 'drm_pvt_ltd';
  END IF;
  SELECT id INTO v_hosp_company FROM public.companies WHERE company_key = v_hosp_key;
  SELECT id INTO v_ml_company   FROM public.companies WHERE company_key = 'ml_enterprises';
  IF v_hosp_company IS NULL OR v_ml_company IS NULL THEN
    RAISE EXCEPTION 'Run the M.L. Enterprises setup migration first';
  END IF;

  -- The same five ledgers the DRR referral approval uses.
  SELECT id INTO v_party
    FROM public.chart_of_accounts
   WHERE company_id = v_hosp_company AND is_active = true
     AND lower(btrim(account_name)) = 'm.l. enterprises'
   LIMIT 1;
  SELECT id INTO v_expense
    FROM public.chart_of_accounts
   WHERE (company_id = v_hosp_company OR company_id IS NULL) AND is_active = true
     AND lower(btrim(account_name)) = 'implant purchase'
     AND account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES')
   ORDER BY (company_id = v_hosp_company) DESC
   LIMIT 1;
  SELECT id INTO v_debtor
    FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true
     AND lower(btrim(account_name)) =
         CASE WHEN v_hosp_key = 'ayushman_nagpur' THEN 'ayushman hospital' ELSE 'hope hospital' END
   LIMIT 1;
  SELECT id INTO v_sales FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true AND lower(btrim(account_name)) = 'sales' LIMIT 1;
  SELECT id INTO v_comm FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true AND lower(btrim(account_name)) = 'referral commission' LIMIT 1;
  IF v_party IS NULL OR v_expense IS NULL OR v_debtor IS NULL OR v_sales IS NULL OR v_comm IS NULL THEN
    RAISE EXCEPTION 'The M.L. Enterprises ledgers are missing — run the setup migration';
  END IF;

  -- The referee's creditor ledger in M.L. Enterprises' books, created on
  -- first use — same as a new relationship manager on the revenue report.
  SELECT id INTO v_rm_ledger
    FROM public.chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true
     AND lower(btrim(account_name)) = lower(v_referee_name)
   LIMIT 1;
  IF v_rm_ledger IS NULL THEN
    INSERT INTO public.chart_of_accounts
      (account_code, account_name, account_type, account_group, company_id,
       opening_balance, opening_balance_type, is_active)
    VALUES
      ('MLRM_' || lpad(nextval('public.ml_rm_ledger_seq')::TEXT, 6, '0'),
       v_referee_name, 'CURRENT_LIABILITIES', 'Sundry Creditors',
       v_ml_company, 0, 'CR', true)
    RETURNING id INTO v_rm_ledger;
  END IF;

  -- Hospital side: the bill. Its trigger posts Dr Implant Purchase /
  -- Cr M.L. Enterprises; it is paid later from the Expense Bill page.
  v_bill_no := public.next_ml_invoice_number();
  v_narr := 'Implant purchase (spot) — ' || btrim(p_patient_name)
         || ' (IPD, RM ' || v_referee_name || ')';
  INSERT INTO public.expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    narration, company_id, status, created_by,
    relationship_manager, patient_name, patient_type
  ) VALUES (
    v_bill_no, CURRENT_DATE, v_party, v_expense, p_max_spot,
    v_narr, v_hosp_company, 'POSTED', v_user,
    v_referee_name, btrim(p_patient_name), 'IPD'
  ) RETURNING id INTO v_bill_id;

  -- M.L. Enterprises side: sale to the hospital, commission to the referee.
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active JOURNAL voucher type is configured';
  END IF;

  v_voucher_id := gen_random_uuid();
  v_sales_vno  := public.generate_voucher_number(v_type_code);
  v_narr := 'Sale of implant (spot) — ' || btrim(p_patient_name) || ', invoice ' || v_bill_no;
  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_sales_vno, v_type_id, CURRENT_DATE, v_bill_no,
    v_narr, p_max_spot, v_ml_company, 'AUTHORISED', v_user, NOW(), NOW()
  );
  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor, v_narr, p_max_spot, 0, 1, v_bill_no, NOW()),
    (gen_random_uuid(), v_voucher_id, v_sales,  v_narr, 0, p_max_spot, 2, NULL, NOW());

  v_voucher_id := gen_random_uuid();
  v_comm_vno   := public.generate_voucher_number(v_type_code);
  v_narr := 'Spot commission ' || v_referee_name || ' — ' || btrim(p_patient_name)
         || ', invoice ' || v_bill_no;
  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_comm_vno, v_type_id, CURRENT_DATE, v_bill_no,
    v_narr, p_max_spot, v_ml_company, 'AUTHORISED', v_user, NOW(), NOW()
  );
  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_comm,      v_narr, p_max_spot, 0, 1, NULL, NOW()),
    (gen_random_uuid(), v_voucher_id, v_rm_ledger, v_narr, 0, p_max_spot, 2, v_bill_no, NOW());

  INSERT INTO public.spot_payment_approvals (
    referee_ledger_id, referee_ledger_name, patient_id, patient_name, visit_id,
    deposit_paid, deposit_to_collect, max_spot, approved_by,
    expense_bill_id, ml_invoice_number
  ) VALUES (
    p_referee_ledger_id, v_referee_name, p_patient_id, btrim(p_patient_name), p_visit_id,
    COALESCE(p_deposit_paid, 0), p_deposit_to_collect, p_max_spot, v_user,
    v_bill_id, v_bill_no
  ) RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'approvalId',        v_approval_id,
    'invoiceNumber',     v_bill_no,
    'salesVoucher',      v_sales_vno,
    'commissionVoucher', v_comm_vno,
    'companyKey',        v_hosp_key
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_spot_approval(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_spot_approval(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Proof: the ceiling guard fires before anything is written.
DO $verify$
BEGIN
  BEGIN
    PERFORM public.record_spot_approval(
      '00000000-0000-0000-0000-000000000001'::uuid,
      NULL, 'X', NULL, 0, NULL, 9000, 'hope', 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%between 1 and 8,000%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK — record_spot_approval guards hold: %', SQLERRM;
  END;
END;
$verify$;

COMMIT;
