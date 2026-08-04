-- Audit fixes (4-Aug session review).
--
-- 1. approve_daily_revenue_referral: a manually added Daily Revenue row has
--    no visit, so v_patient_type stayed NULL and `NULL NOT IN (...)` skipped
--    the OPD fallback — the invoice posted correctly but appeared in neither
--    referral section of the Expense Bill page. NULL now falls back to OPD,
--    and any bill already created that way is repaired.
-- 2. panel-payments screenshots had no DELETE storage policy, so the tile's
--    failure cleanup silently left orphaned files.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.approve_daily_revenue_referral(
  p_entry_id      UUID,
  p_bill_number   TEXT,
  p_document_path TEXT,
  p_document_url  TEXT,
  p_created_by    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry          RECORD;
  v_hosp_company   UUID;
  v_hosp_key       TEXT;
  v_ml_company     UUID;
  v_party          UUID;
  v_expense        UUID;
  v_debtor         UUID;
  v_sales          UUID;
  v_comm           UUID;
  v_rm_ledger      UUID;
  v_patient_type   TEXT;
  v_bill_id        UUID;
  v_type_id        UUID;
  v_type_code      TEXT;
  v_sales_vno      TEXT;
  v_comm_vno       TEXT;
  v_voucher_id     UUID;
  v_narr           TEXT;
BEGIN
  IF btrim(COALESCE(p_bill_number, '')) = '' THEN
    RAISE EXCEPTION 'A bill number is required';
  END IF;
  IF p_document_path IS NULL OR p_document_url IS NULL THEN
    RAISE EXCEPTION 'The generated invoice document is required';
  END IF;

  SELECT * INTO v_entry
    FROM daily_revenue_entries
   WHERE id = p_entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This report row no longer exists';
  END IF;
  IF v_entry.expense_bill_id IS NOT NULL THEN
    RAISE EXCEPTION 'This row has already been approved and invoiced';
  END IF;
  IF v_entry.approval_id IS NOT NULL THEN
    RAISE EXCEPTION 'This row was already paid through the old approval flow';
  END IF;
  IF COALESCE(v_entry.is_hidden, false) THEN
    RAISE EXCEPTION 'A hidden row cannot be approved';
  END IF;
  IF COALESCE(v_entry.cut, 0) <= 0 THEN
    RAISE EXCEPTION 'This row has no cut to approve';
  END IF;
  IF btrim(COALESCE(v_entry.rm_name, '')) = '' OR upper(btrim(v_entry.rm_name)) = 'DIRECT' THEN
    RAISE EXCEPTION 'Direct patients have no relationship manager to pay';
  END IF;

  IF lower(COALESCE(v_entry.hospital_type, '')) LIKE '%ayush%' THEN
    v_hosp_key := 'ayushman_nagpur';
  ELSE
    v_hosp_key := 'drm_pvt_ltd';
  END IF;
  SELECT id INTO v_hosp_company FROM companies WHERE company_key = v_hosp_key;
  SELECT id INTO v_ml_company   FROM companies WHERE company_key = 'ml_enterprises';
  IF v_hosp_company IS NULL OR v_ml_company IS NULL THEN
    RAISE EXCEPTION 'Run the M.L. Enterprises setup migration first';
  END IF;

  SELECT id INTO v_party
    FROM chart_of_accounts
   WHERE company_id = v_hosp_company AND is_active = true
     AND lower(btrim(account_name)) = 'm.l. enterprises'
   LIMIT 1;
  SELECT id INTO v_expense
    FROM chart_of_accounts
   WHERE (company_id = v_hosp_company OR company_id IS NULL) AND is_active = true
     AND lower(btrim(account_name)) = 'implant purchase'
     AND account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES')
   ORDER BY (company_id = v_hosp_company) DESC
   LIMIT 1;
  SELECT id INTO v_debtor
    FROM chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true
     AND lower(btrim(account_name)) =
         CASE WHEN v_hosp_key = 'ayushman_nagpur' THEN 'ayushman hospital' ELSE 'hope hospital' END
   LIMIT 1;
  SELECT id INTO v_sales FROM chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true AND lower(btrim(account_name)) = 'sales' LIMIT 1;
  SELECT id INTO v_comm FROM chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true AND lower(btrim(account_name)) = 'referral commission' LIMIT 1;
  IF v_party IS NULL OR v_expense IS NULL OR v_debtor IS NULL OR v_sales IS NULL OR v_comm IS NULL THEN
    RAISE EXCEPTION 'The M.L. Enterprises ledgers are missing — run the setup migration';
  END IF;

  SELECT id INTO v_rm_ledger
    FROM chart_of_accounts
   WHERE company_id = v_ml_company AND is_active = true
     AND lower(btrim(account_name)) = lower(btrim(v_entry.rm_name))
   LIMIT 1;
  IF v_rm_ledger IS NULL THEN
    INSERT INTO chart_of_accounts
      (account_code, account_name, account_type, account_group, company_id,
       opening_balance, opening_balance_type, is_active)
    VALUES
      ('MLRM_' || lpad(nextval('public.ml_rm_ledger_seq')::TEXT, 6, '0'),
       btrim(v_entry.rm_name), 'CURRENT_LIABILITIES', 'Sundry Creditors',
       v_ml_company, 0, 'CR', true)
    RETURNING id INTO v_rm_ledger;
  END IF;

  -- Manual report rows have no visit; they are entered on the OPD sheet, so
  -- OPD is the fallback. (Previously `NULL NOT IN (...)` skipped this branch
  -- and the invoice vanished from both referral sections.)
  v_patient_type := NULL;
  IF v_entry.visit_id IS NOT NULL THEN
    SELECT upper(COALESCE(patient_type, '')) INTO v_patient_type
      FROM visits WHERE id = v_entry.visit_id;
  END IF;
  IF v_patient_type IS NULL OR v_patient_type NOT IN ('OPD', 'IPD') THEN
    v_patient_type := 'OPD';
  END IF;

  v_narr := 'Implant purchase — ' || COALESCE(v_entry.patient_name, 'patient')
         || ' (' || v_patient_type || ', RM ' || btrim(v_entry.rm_name) || ')';
  INSERT INTO expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    narration, document_path, document_url, company_id, status, created_by,
    relationship_manager, patient_name, patient_type, revenue_entry_id
  ) VALUES (
    btrim(p_bill_number), COALESCE(v_entry.entry_date, CURRENT_DATE),
    v_party, v_expense, v_entry.cut,
    v_narr, p_document_path, p_document_url, v_hosp_company, 'POSTED',
    COALESCE(NULLIF(btrim(p_created_by), ''), 'drr-referral-approve'),
    btrim(v_entry.rm_name), v_entry.patient_name, v_patient_type, v_entry.id
  ) RETURNING id INTO v_bill_id;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active JOURNAL voucher type is configured';
  END IF;

  v_voucher_id := gen_random_uuid();
  v_sales_vno  := generate_voucher_number(v_type_code);
  v_narr := 'Sale of implant — ' || COALESCE(v_entry.patient_name, 'patient')
         || ', invoice ' || btrim(p_bill_number);
  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_sales_vno, v_type_id, COALESCE(v_entry.entry_date, CURRENT_DATE),
    btrim(p_bill_number), v_narr, v_entry.cut, v_ml_company, 'AUTHORISED',
    COALESCE(NULLIF(btrim(p_created_by), ''), 'drr-referral-approve'), NOW(), NOW()
  );
  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debtor, v_narr, v_entry.cut, 0, 1, btrim(p_bill_number), NOW()),
    (gen_random_uuid(), v_voucher_id, v_sales,  v_narr, 0, v_entry.cut, 2, NULL, NOW());

  v_voucher_id := gen_random_uuid();
  v_comm_vno   := generate_voucher_number(v_type_code);
  v_narr := 'Referral commission ' || btrim(v_entry.rm_name) || ' — '
         || COALESCE(v_entry.patient_name, 'patient') || ', invoice ' || btrim(p_bill_number);
  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_comm_vno, v_type_id, COALESCE(v_entry.entry_date, CURRENT_DATE),
    btrim(p_bill_number), v_narr, v_entry.cut, v_ml_company, 'AUTHORISED',
    COALESCE(NULLIF(btrim(p_created_by), ''), 'drr-referral-approve'), NOW(), NOW()
  );
  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_comm,      v_narr, v_entry.cut, 0, 1, NULL, NOW()),
    (gen_random_uuid(), v_voucher_id, v_rm_ledger, v_narr, 0, v_entry.cut, 2, btrim(p_bill_number), NOW());

  UPDATE daily_revenue_entries
     SET expense_bill_id = v_bill_id,
         updated_at = NOW()
   WHERE id = p_entry_id;

  RETURN jsonb_build_object(
    'bill_id', v_bill_id,
    'bill_number', btrim(p_bill_number),
    'company_key', v_hosp_key,
    'sales_voucher', v_sales_vno,
    'commission_voucher', v_comm_vno
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_daily_revenue_referral(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_daily_revenue_referral(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Repair any referral invoice already created without a patient type.
UPDATE public.expense_bills
   SET patient_type = 'OPD', updated_at = now()
 WHERE revenue_entry_id IS NOT NULL AND patient_type IS NULL;

-- The tile's failure cleanup needs delete rights on its own uploads.
DROP POLICY IF EXISTS "panel_payment_screenshot_delete" ON storage.objects;
CREATE POLICY "panel_payment_screenshot_delete"
  ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = 'panel-payments');

NOTIFY pgrst, 'reload schema';

COMMIT;
