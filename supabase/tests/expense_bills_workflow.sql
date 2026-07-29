-- Rollback-only Expense Bills accounting integration test.
--
-- Run in Supabase SQL Editor AFTER
--   20260728180000_harden_expense_bills.sql
--   20260729110000_expense_bill_payable_parties.sql
--
-- Success ends with "Expense Bills rollback test passed". Every bill, voucher,
-- voucher entry, audit row, and voucher-number increment made here is rolled
-- back. This script does not create a Storage object; storage is smoke-tested
-- separately with an upload/read/delete cycle.

BEGIN;

DO $$
DECLARE
  v_company_id       UUID;
  v_party_id         UUID;
  v_consultant_id    UUID;
  v_expense_id       UUID;
  v_income_id        UUID;
  v_bank_id          UUID;
  v_other_bank_id    UUID;
  v_bill_id          UUID;
  v_consultant_bill  UUID;
  v_arbitrary_bill   UUID;
  v_accrual_id       UUID;
  v_payment_no       TEXT;
  v_category         TEXT;
  v_debits           NUMERIC;
  v_credits          NUMERIC;
  v_outstanding      NUMERIC;
  v_rejected         BOOLEAN;
  v_invoice_number   TEXT := 'CODEX-EXPENSE-BILL-ROLLBACK-TEST';
BEGIN
  SELECT id INTO v_company_id
    FROM public.companies
   WHERE company_key = 'drm_pvt_ltd'
   LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Test setup failed: drm_pvt_ltd company is missing';
  END IF;

  SELECT id INTO v_party_id
    FROM public.chart_of_accounts
   WHERE is_active = true
     AND lower(COALESCE(account_group, '')) LIKE '%creditor%'
     AND (company_id = v_company_id OR company_id IS NULL)
   ORDER BY CASE WHEN company_id = v_company_id THEN 0 ELSE 1 END, account_name
   LIMIT 1;

  SELECT id INTO v_expense_id
    FROM public.chart_of_accounts
   WHERE is_active = true
     AND account_type IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES')
     AND (company_id = v_company_id OR company_id IS NULL)
   ORDER BY CASE WHEN company_id = v_company_id THEN 0 ELSE 1 END, account_name
   LIMIT 1;

  SELECT id INTO v_bank_id
    FROM public.chart_of_accounts
   WHERE is_active = true
     AND (
       lower(COALESCE(account_group, '')) LIKE '%cash%'
       OR lower(COALESCE(account_group, '')) LIKE '%bank%'
     )
     AND (company_id = v_company_id OR company_id IS NULL)
   ORDER BY CASE WHEN company_id = v_company_id THEN 0 ELSE 1 END, account_name
   LIMIT 1;

  SELECT id INTO v_income_id
    FROM public.chart_of_accounts
   WHERE is_active = true
     AND account_type IN ('INCOME', 'DIRECT_INCOME', 'INDIRECT_INCOME')
     AND (company_id = v_company_id OR company_id IS NULL)
   ORDER BY CASE WHEN company_id = v_company_id THEN 0 ELSE 1 END, account_name
   LIMIT 1;

  IF v_party_id IS NULL OR v_expense_id IS NULL OR v_bank_id IS NULL OR v_income_id IS NULL THEN
    RAISE EXCEPTION
      'Test setup failed: compatible supplier, expense, income, or Cash/Bank ledger is missing';
  END IF;

  -- Tally imports consultant/salary payees in their own party groups rather
  -- than Sundry Creditors. This rollback-only row proves that such a payable
  -- can be credited without opening the bill-from picker to expense heads.
  INSERT INTO public.chart_of_accounts (
    account_code, account_name, account_type, account_group,
    opening_balance, opening_balance_type, is_active, company_id
  ) VALUES (
    left('CODEX-CONS-' || replace(gen_random_uuid()::TEXT, '-', ''), 20),
    'CODEX rollback consultant',
    'CURRENT_ASSETS',
    'Consultant',
    0,
    'CR',
    true,
    v_company_id
  )
  RETURNING id INTO v_consultant_id;

  INSERT INTO public.expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    document_path, document_url, company_id, created_by
  ) VALUES (
    v_invoice_number || '-CONSULTANT', CURRENT_DATE, v_consultant_id, v_expense_id, 25,
    'expense-bills/rollback-consultant.pdf',
    'https://example.invalid/expense-bills/rollback-consultant.pdf',
    v_company_id, 'rollback-test'
  )
  RETURNING id INTO v_consultant_bill;

  IF NOT EXISTS (
    SELECT 1
      FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id
     WHERE v.reference_number = v_consultant_bill::TEXT
       AND e.account_id = v_consultant_id
       AND e.credit_amount = 25
  ) THEN
    RAISE EXCEPTION 'Payable-party assertion failed: consultant credit entry is missing';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.expense_bills (
      bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
      document_path, document_url, company_id, created_by
    ) VALUES (
      v_invoice_number || '-EXPENSE-PARTY', CURRENT_DATE, v_expense_id, v_expense_id, 10,
      'expense-bills/rejected-expense-party.pdf',
      'https://example.invalid/expense-bills/rejected-expense-party.pdf',
      v_company_id, 'rollback-test'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Distinct-ledger assertion failed: the same ledger was accepted on both sides';
  END IF;

  INSERT INTO public.expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    document_path, document_url, company_id, created_by
  ) VALUES (
    v_invoice_number || '-BANK-PARTY', CURRENT_DATE, v_bank_id, v_expense_id, 10,
    'expense-bills/bank-party.pdf',
    'https://example.invalid/expense-bills/bank-party.pdf',
    v_company_id, 'rollback-test'
  )
  RETURNING id INTO v_arbitrary_bill;
  IF NOT EXISTS (
    SELECT 1
      FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id
     WHERE v.reference_number = v_arbitrary_bill::TEXT
       AND e.account_id = v_bank_id
       AND e.credit_amount = 10
  ) THEN
    RAISE EXCEPTION 'Arbitrary-ledger assertion failed: Cash/Bank credit is missing';
  END IF;

  INSERT INTO public.expense_bills (
    bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
    document_path, document_url, company_id, created_by
  ) VALUES (
    v_invoice_number || '-INCOME-PARTY', CURRENT_DATE, v_income_id, v_expense_id, 10,
    'expense-bills/income-party.pdf',
    'https://example.invalid/expense-bills/income-party.pdf',
    v_company_id, 'rollback-test'
  )
  RETURNING id INTO v_arbitrary_bill;
  IF NOT EXISTS (
    SELECT 1
      FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id
     WHERE v.reference_number = v_arbitrary_bill::TEXT
       AND e.account_id = v_income_id
       AND e.credit_amount = 10
  ) THEN
    RAISE EXCEPTION 'Arbitrary-ledger assertion failed: income credit is missing';
  END IF;

  INSERT INTO public.expense_bills (
    bill_number, bill_date, due_date, party_ledger_id, expense_ledger_id,
    amount, narration, document_path, document_url, company_id, created_by
  ) VALUES (
    v_invoice_number, CURRENT_DATE, CURRENT_DATE + 7, v_party_id, v_expense_id,
    100, 'Rollback-only Expense Bills test',
    'expense-bills/rollback-test.pdf',
    'https://example.invalid/expense-bills/rollback-test.pdf',
    v_company_id, 'rollback-test'
  )
  RETURNING id INTO v_bill_id;

  SELECT v.id, vt.voucher_category
    INTO v_accrual_id, v_category
    FROM public.vouchers v
    JOIN public.voucher_types vt ON vt.id = v.voucher_type_id
   WHERE v.reference_number = v_bill_id::TEXT
     AND v.status = 'AUTHORISED';

  IF v_accrual_id IS NULL OR v_category NOT IN ('PURCHASE', 'JOURNAL') THEN
    RAISE EXCEPTION 'Accrual assertion failed: expected an authorised Purchase/JV';
  END IF;

  SELECT COALESCE(sum(debit_amount), 0), COALESCE(sum(credit_amount), 0)
    INTO v_debits, v_credits
    FROM public.voucher_entries
   WHERE voucher_id = v_accrual_id;
  IF v_debits <> 100 OR v_credits <> 100 THEN
    RAISE EXCEPTION 'Accrual assertion failed: expected balanced 100/100 entries, got %/%',
      v_debits, v_credits;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.voucher_entries
     WHERE voucher_id = v_accrual_id
       AND account_id = v_party_id
       AND credit_amount = 100
       AND bill_ref = v_invoice_number
  ) THEN
    RAISE EXCEPTION 'Accrual assertion failed: supplier bill_ref entry is missing';
  END IF;

  v_payment_no := public.record_expense_bill_payment(
    v_bill_id, 40, v_bank_id, CURRENT_DATE, 'rollback-test'
  );
  IF btrim(COALESCE(v_payment_no, '')) = '' THEN
    RAISE EXCEPTION 'Partial-payment assertion failed: no Payment Voucher number returned';
  END IF;

  SELECT outstanding INTO v_outstanding
    FROM public.v_expense_bills_outstanding
   WHERE id = v_bill_id AND company_id = v_company_id;
  IF v_outstanding <> 60 THEN
    RAISE EXCEPTION 'Partial-payment assertion failed: expected 60 outstanding, got %',
      v_outstanding;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.vouchers v
      JOIN public.voucher_types vt ON vt.id = v.voucher_type_id
      JOIN public.voucher_entries party ON party.voucher_id = v.id
      JOIN public.voucher_entries bank ON bank.voucher_id = v.id
     WHERE v.voucher_number = v_payment_no
       AND v.company_id = v_company_id
       AND v.status = 'AUTHORISED'
       AND vt.voucher_category = 'PAYMENT'
       AND party.account_id = v_party_id
       AND party.debit_amount = 40
       AND party.bill_ref = v_invoice_number
       AND bank.account_id = v_bank_id
       AND bank.credit_amount = 40
  ) THEN
    RAISE EXCEPTION 'Partial-payment assertion failed: balanced Payment Voucher legs are missing';
  END IF;

  PERFORM public.record_expense_bill_payment(
    v_bill_id, 60, v_bank_id, CURRENT_DATE, 'rollback-test'
  );
  SELECT outstanding INTO v_outstanding
    FROM public.v_expense_bills_outstanding
   WHERE id = v_bill_id AND company_id = v_company_id;
  IF v_outstanding <> 0 THEN
    RAISE EXCEPTION 'Full-payment assertion failed: expected zero outstanding, got %',
      v_outstanding;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.record_expense_bill_payment(
      v_bill_id, 1, v_bank_id, CURRENT_DATE, 'rollback-test'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Overpayment assertion failed: payment was accepted on a settled invoice';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.expense_bills (
      bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
      document_path, document_url, company_id, created_by
    ) VALUES (
      lower(v_invoice_number), CURRENT_DATE, v_party_id, v_expense_id, 10,
      'expense-bills/duplicate-test.pdf',
      'https://example.invalid/expense-bills/duplicate-test.pdf',
      v_company_id, 'rollback-test'
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Duplicate assertion failed: normalized duplicate invoice was accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.record_expense_bill_payment(
      v_bill_id, 1, v_expense_id, CURRENT_DATE, 'rollback-test'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Payment-account assertion failed: an expense ledger was accepted as Cash/Bank';
  END IF;

  SELECT id INTO v_other_bank_id
    FROM public.chart_of_accounts
   WHERE is_active = true
     AND company_id IS NOT NULL
     AND company_id <> v_company_id
     AND (
       lower(COALESCE(account_group, '')) LIKE '%cash%'
       OR lower(COALESCE(account_group, '')) LIKE '%bank%'
     )
   LIMIT 1;
  IF v_other_bank_id IS NOT NULL THEN
    v_rejected := false;
    BEGIN
      INSERT INTO public.expense_bills (
        bill_number, bill_date, party_ledger_id, expense_ledger_id, amount,
        document_path, document_url, company_id, created_by
      ) VALUES (
        v_invoice_number || '-OTHER-COMPANY', CURRENT_DATE,
        v_other_bank_id, v_expense_id, 10,
        'expense-bills/rejected-other-company.pdf',
        'https://example.invalid/expense-bills/rejected-other-company.pdf',
        v_company_id, 'rollback-test'
      );
    EXCEPTION WHEN OTHERS THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Company assertion failed: another company''s ledger was accepted';
    END IF;

    v_rejected := false;
    BEGIN
      PERFORM public.record_expense_bill_payment(
        v_bill_id, 1, v_other_bank_id, CURRENT_DATE, 'rollback-test'
      );
    EXCEPTION WHEN OTHERS THEN
      v_rejected := true;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Company assertion failed: another company''s bank was accepted';
    END IF;
  END IF;

  IF NOT has_table_privilege('anon', 'public.expense_bills', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.expense_bills', 'INSERT')
     OR NOT has_function_privilege(
       'anon',
       'public.record_expense_bill_payment(uuid,numeric,uuid,date,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Permission assertion failed: anon custom-login access is incomplete';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname IN (
         'expense_bill_invoice_insert',
         'expense_bill_invoice_select',
         'expense_bill_invoice_delete'
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'Storage-policy assertion failed';
  END IF;

  RAISE NOTICE 'Expense Bills rollback test passed';
END;
$$;

ROLLBACK;
