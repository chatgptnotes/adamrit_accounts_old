-- M.L. Enterprises referral invoices: per-row Daily Revenue Report approval.
--
-- The Director's decision (2026-08-04): each RM cut on the Daily Revenue
-- Report is approved row by row. Approving a row raises an M.L. Enterprises
-- implant-purchase invoice on the patient's hospital and posts BOTH sides:
--
--   Hospital books (DRM Hope / Ayushman):
--     expense_bills row -> its trigger posts  Dr Implant Purchase / Cr M.L. Enterprises
--   M.L. Enterprises books (new 5th company):
--     JV  Dr <Hope|Ayushman> Hospital (debtor) / Cr Sales
--     JV  Dr Referral Commission / Cr <the manager's ledger>
--
-- Nothing is paid at approval. The bill sits outstanding on the new desktop
-- Expense Bill page, where accounting pays it later (Dr M.L. Enterprises /
-- Cr Cash-Bank via record_expense_bill_payment).
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ------------------------------------------------------------------
-- 1. M.L. Enterprises as the fifth accounting company
-- ------------------------------------------------------------------
INSERT INTO public.companies (company_key, company_name, company_type, address, is_active)
SELECT 'ml_enterprises', 'M.L. Enterprises', 'PROPRIETORSHIP',
       'B-6, Plot No. 3, Chaya Complex, Wathoda Ring Road, Nagpur', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies WHERE company_key = 'ml_enterprises'
);

-- ------------------------------------------------------------------
-- 2. Ledgers. account_code is globally unique, so every one gets its
--    own MLE_/MLS_ code. Created only if the (company, name) pair is new.
-- ------------------------------------------------------------------
DO $$
DECLARE
  v_drm  UUID;
  v_ay   UUID;
  v_ml   UUID;
BEGIN
  SELECT id INTO v_drm FROM public.companies WHERE company_key = 'drm_pvt_ltd';
  SELECT id INTO v_ay  FROM public.companies WHERE company_key = 'ayushman_nagpur';
  SELECT id INTO v_ml  FROM public.companies WHERE company_key = 'ml_enterprises';
  IF v_drm IS NULL OR v_ay IS NULL OR v_ml IS NULL THEN
    RAISE EXCEPTION 'companies drm_pvt_ltd / ayushman_nagpur / ml_enterprises must all exist';
  END IF;

  -- M.L. Enterprises as a supplier in each hospital's books.
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLE_DRM', 'M.L. Enterprises', 'CURRENT_LIABILITIES', 'Sundry Creditors', v_drm, 0, 'CR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_drm AND lower(btrim(account_name)) = 'm.l. enterprises');

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLE_AYUSH', 'M.L. Enterprises', 'CURRENT_LIABILITIES', 'Sundry Creditors', v_ay, 0, 'CR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ay AND lower(btrim(account_name)) = 'm.l. enterprises');

  -- The expense head the hospital debits. The tablet's Implant category
  -- already maps to a ledger literally named "Implant Purchase".
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'IMPL_DRM', 'Implant Purchase', 'DIRECT_EXPENSES', 'Direct Expenses', v_drm, 0, 'DR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE (company_id = v_drm OR company_id IS NULL)
                       AND lower(btrim(account_name)) = 'implant purchase'
                       AND account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES'));

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'IMPL_AYUSH', 'Implant Purchase', 'DIRECT_EXPENSES', 'Direct Expenses', v_ay, 0, 'DR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ay
                       AND lower(btrim(account_name)) = 'implant purchase'
                       AND account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES'));

  -- M.L. Enterprises' own chart.
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLS_HOPE', 'Hope Hospital', 'CURRENT_ASSETS', 'Sundry Debtors', v_ml, 0, 'DR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ml AND lower(btrim(account_name)) = 'hope hospital');

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLS_AYUSH', 'Ayushman Hospital', 'CURRENT_ASSETS', 'Sundry Debtors', v_ml, 0, 'DR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ml AND lower(btrim(account_name)) = 'ayushman hospital');

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLS_SALES', 'Sales', 'INCOME', 'Sales Accounts', v_ml, 0, 'CR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ml AND lower(btrim(account_name)) = 'sales');

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLS_COMM', 'Referral Commission', 'INDIRECT_EXPENSES', 'Indirect Expenses', v_ml, 0, 'DR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ml AND lower(btrim(account_name)) = 'referral commission');

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id,
     opening_balance, opening_balance_type, is_active)
  SELECT 'MLS_CASH', 'Cash', 'CURRENT_ASSETS', 'Cash-in-Hand', v_ml, 0, 'DR', true
  WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                     WHERE company_id = v_ml AND lower(btrim(account_name)) = 'cash');
END;
$$;

-- ------------------------------------------------------------------
-- 3. Columns the Expense Bill page searches and the referral flow stamps
-- ------------------------------------------------------------------
ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS point_of_contact     TEXT,
  ADD COLUMN IF NOT EXISTS relationship_manager TEXT,
  ADD COLUMN IF NOT EXISTS patient_name         TEXT,
  ADD COLUMN IF NOT EXISTS patient_type         TEXT
    CHECK (patient_type IS NULL OR patient_type IN ('OPD', 'IPD')),
  ADD COLUMN IF NOT EXISTS revenue_entry_id     UUID REFERENCES public.daily_revenue_entries(id);

CREATE INDEX IF NOT EXISTS idx_expense_bills_revenue_entry
  ON public.expense_bills(revenue_entry_id) WHERE revenue_entry_id IS NOT NULL;

-- The stamp that keeps an approved cut off the pending list forever. Kept
-- separate from approval_id (the legacy pay-immediately path) so both guards
-- stay readable.
ALTER TABLE public.daily_revenue_entries
  ADD COLUMN IF NOT EXISTS expense_bill_id UUID REFERENCES public.expense_bills(id);

CREATE INDEX IF NOT EXISTS idx_daily_revenue_entries_expense_bill
  ON public.daily_revenue_entries(expense_bill_id) WHERE expense_bill_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 4. Rebuild the outstanding view: same leading columns, new ones appended
-- ------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_expense_bills_outstanding;
CREATE VIEW public.v_expense_bills_outstanding AS
SELECT b.id,
       b.bill_number,
       b.bill_date,
       b.due_date,
       p.account_name                                   AS party,
       x.account_name                                   AS expense_head,
       b.amount                                         AS billed,
       COALESCE(paid.amount, 0)                         AS paid,
       b.amount - COALESCE(paid.amount, 0)              AS outstanding,
       b.document_url,
       b.status,
       b.company_id,
       b.narration,
       b.point_of_contact,
       b.relationship_manager,
       b.patient_name,
       b.patient_type,
       b.revenue_entry_id,
       b.created_at
  FROM public.expense_bills b
  JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
  JOIN public.chart_of_accounts x ON x.id = b.expense_ledger_id
  LEFT JOIN LATERAL (
    SELECT sum(e.debit_amount) AS amount
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id
     WHERE e.account_id = b.party_ledger_id
       AND btrim(COALESCE(e.bill_ref, '')) = btrim(b.bill_number)
       AND v.company_id IS NOT DISTINCT FROM b.company_id
       AND v.status = 'AUTHORISED'
       AND e.debit_amount > 0
  ) paid ON true
 WHERE b.status = 'POSTED';

ALTER VIEW public.v_expense_bills_outstanding SET (security_invoker = true);
GRANT SELECT ON public.v_expense_bills_outstanding TO anon, authenticated;

-- ------------------------------------------------------------------
-- 5. Invoice numbering for the generated M.L. Enterprises bills.
--    The handwritten book was around 1244; start clear of it.
-- ------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.ml_enterprises_invoice_seq START 1301;
CREATE SEQUENCE IF NOT EXISTS public.ml_rm_ledger_seq START 1;

CREATE OR REPLACE FUNCTION public.next_ml_invoice_number()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'MLE-' || nextval('public.ml_enterprises_invoice_seq')::TEXT;
$$;

REVOKE ALL ON FUNCTION public.next_ml_invoice_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_ml_invoice_number() TO anon, authenticated;

-- ------------------------------------------------------------------
-- 6. The per-row approval itself: one call posts both companies' entries
-- ------------------------------------------------------------------
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
  v_party          UUID;   -- M.L. Enterprises in the hospital's books
  v_expense        UUID;   -- Implant Purchase in the hospital's books
  v_debtor         UUID;   -- the hospital in ML's books
  v_sales          UUID;
  v_comm           UUID;
  v_rm_ledger      UUID;   -- the manager in ML's books
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

  -- Which hospital bought the "implant".
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

  -- The manager's creditor ledger in M.L. Enterprises' books, created on
  -- first use so a new manager never blocks an approval.
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

  -- Patient type decides which Expense Bill section the invoice lists under.
  v_patient_type := NULL;
  IF v_entry.visit_id IS NOT NULL THEN
    SELECT upper(COALESCE(patient_type, '')) INTO v_patient_type
      FROM visits WHERE id = v_entry.visit_id;
  END IF;
  IF v_patient_type NOT IN ('OPD', 'IPD') THEN
    v_patient_type := 'OPD';
  END IF;

  -- Hospital side: the bill row. Its own trigger posts
  -- Dr Implant Purchase / Cr M.L. Enterprises as a JV.
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

  -- M.L. Enterprises side: two journals.
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active JOURNAL voucher type is configured';
  END IF;

  -- Sale to the hospital.
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

  -- The manager's commission, payable by M.L. Enterprises.
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

-- ------------------------------------------------------------------
-- 7. Payment RPC gains an optional remarks line for the desktop Pay form.
--    Dropped first so the old 5-arg signature does not survive as an
--    ambiguous overload.
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.record_expense_bill_payment(
  p_bill_id         UUID,
  p_amount          NUMERIC,
  p_bank_account_id UUID,
  p_payment_date    DATE DEFAULT CURRENT_DATE,
  p_created_by      TEXT DEFAULT NULL,
  p_remarks         TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill        RECORD;
  v_bank        RECORD;
  v_outstanding NUMERIC(15,2);
  v_type_id     UUID;
  v_type_code   TEXT;
  v_voucher_id  UUID;
  v_voucher_no  TEXT;
  v_narration   TEXT;
BEGIN
  SELECT b.*, p.account_name AS party_name
    INTO v_bill
    FROM public.expense_bills b
    JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
   WHERE b.id = p_bill_id
   FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice no longer exists';
  END IF;
  IF v_bill.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Invoice % has been cancelled and cannot be paid', v_bill.bill_number;
  END IF;

  SELECT id, account_name, account_group, company_id, is_active
    INTO v_bank
    FROM public.chart_of_accounts
   WHERE id = p_bank_account_id;
  IF NOT FOUND OR NOT COALESCE(v_bank.is_active, false) THEN
    RAISE EXCEPTION 'Choose an active Cash or Bank account';
  END IF;
  IF lower(COALESCE(v_bank.account_group, '')) NOT LIKE '%cash%'
     AND lower(COALESCE(v_bank.account_group, '')) NOT LIKE '%bank%' THEN
    RAISE EXCEPTION 'The payment account must be a Cash or Bank ledger';
  END IF;
  IF v_bank.company_id IS NOT NULL AND v_bank.company_id <> v_bill.company_id THEN
    RAISE EXCEPTION 'The payment account belongs to another accounting company';
  END IF;

  SELECT b.amount - COALESCE(paid.amount, 0)
    INTO v_outstanding
    FROM public.expense_bills b
    LEFT JOIN LATERAL (
      SELECT sum(e.debit_amount) AS amount
        FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE e.account_id = b.party_ledger_id
         AND btrim(COALESCE(e.bill_ref, '')) = btrim(b.bill_number)
         AND v.company_id IS NOT DISTINCT FROM b.company_id
         AND v.status = 'AUTHORISED'
         AND e.debit_amount > 0
    ) paid ON true
   WHERE b.id = p_bill_id;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  IF p_amount > v_outstanding + 0.005 THEN
    RAISE EXCEPTION 'Only % is outstanding on invoice %',
      to_char(v_outstanding, 'FM99,99,99,990.00'), v_bill.bill_number;
  END IF;

  SELECT id, voucher_type_code
    INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT'
     AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 WHEN 'PV' THEN 2 ELSE 3 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  v_narration := 'Payment to ' || v_bill.party_name
    || ' against invoice ' || v_bill.bill_number
    || COALESCE(' — ' || NULLIF(btrim(p_remarks), ''), '');
  v_voucher_id := gen_random_uuid();
  v_voucher_no := public.generate_voucher_number(v_type_code);

  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id, COALESCE(p_payment_date, CURRENT_DATE),
    v_bill.bill_number, v_narration, p_amount, v_bill.company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(p_created_by), ''), 'expense-bill-payment'), NOW(), NOW()
  );

  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_bill.party_ledger_id, v_narration,
     p_amount, 0, 1, v_bill.bill_number, NOW()),
    (gen_random_uuid(), v_voucher_id, p_bank_account_id, v_narration,
     0, p_amount, 2, NULL, NOW());

  RETURN v_voucher_no;
END;
$$;

REVOKE ALL ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT, TEXT)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
