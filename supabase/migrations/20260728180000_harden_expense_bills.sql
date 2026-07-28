-- Expense Bills production hardening.
--
-- The live table was empty when this migration was prepared. Refuse to make
-- company/document fields mandatory if incompatible rows appear before this is
-- applied; accounting data must never be guessed or silently rewritten.
--
-- Invoice accrual:
--   Dr Expense / Cr Supplier (Purchase voucher, Journal fallback)
-- Payment:
--   Dr Supplier / Cr Cash-or-Bank (Payment voucher)

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.expense_bills
     WHERE company_id IS NULL
        OR document_path IS NULL
        OR document_url IS NULL
        OR btrim(COALESCE(bill_number, '')) = ''
  ) THEN
    RAISE EXCEPTION
      'Expense Bills hardening stopped: existing rows need company, invoice number, and document fields reviewed first';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.expense_bills
     WHERE status <> 'CANCELLED'
     GROUP BY company_id, party_ledger_id, lower(btrim(bill_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Expense Bills hardening stopped: duplicate live invoice numbers exist for the same company and supplier';
  END IF;
END;
$$;

ALTER TABLE public.expense_bills
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN document_path SET NOT NULL,
  ALTER COLUMN document_url SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.expense_bills'::regclass
       AND conname = 'expense_bills_number_not_blank'
  ) THEN
    ALTER TABLE public.expense_bills
      ADD CONSTRAINT expense_bills_number_not_blank
      CHECK (btrim(bill_number) <> '');
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_bills_live_supplier_invoice
  ON public.expense_bills (
    company_id,
    party_ledger_id,
    lower(btrim(bill_number))
  )
  WHERE status <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS idx_expense_bills_company_date
  ON public.expense_bills(company_id, bill_date DESC);

CREATE OR REPLACE FUNCTION public.validate_expense_bill_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_party   RECORD;
  v_expense RECORD;
BEGIN
  NEW.bill_number := btrim(NEW.bill_number);

  SELECT id, account_group, company_id, is_active
    INTO v_party
    FROM public.chart_of_accounts
   WHERE id = NEW.party_ledger_id;
  IF NOT FOUND OR NOT COALESCE(v_party.is_active, false) THEN
    RAISE EXCEPTION 'Choose an active supplier ledger';
  END IF;
  IF lower(COALESCE(v_party.account_group, '')) NOT LIKE '%creditor%' THEN
    RAISE EXCEPTION 'The selected supplier must be a Sundry Creditors ledger';
  END IF;
  IF v_party.company_id IS NOT NULL AND v_party.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'The supplier ledger belongs to another accounting company';
  END IF;

  SELECT id, account_type, company_id, is_active
    INTO v_expense
    FROM public.chart_of_accounts
   WHERE id = NEW.expense_ledger_id;
  IF NOT FOUND OR NOT COALESCE(v_expense.is_active, false) THEN
    RAISE EXCEPTION 'Choose an active expense ledger';
  END IF;
  IF COALESCE(v_expense.account_type, '') NOT IN ('DIRECT_EXPENSES', 'INDIRECT_EXPENSES') THEN
    RAISE EXCEPTION 'The selected account is not an expense ledger';
  END IF;
  IF v_expense.company_id IS NOT NULL AND v_expense.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'The expense ledger belongs to another accounting company';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_expense_bill_accounts ON public.expense_bills;
CREATE TRIGGER trg_validate_expense_bill_accounts
BEFORE INSERT OR UPDATE OF bill_number, party_ledger_id, expense_ledger_id, company_id
ON public.expense_bills
FOR EACH ROW
EXECUTE FUNCTION public.validate_expense_bill_accounts();

-- Keep the original public column order and append company_id so existing
-- consumers remain compatible while the tablet can scope its query.
CREATE OR REPLACE VIEW public.v_expense_bills_outstanding AS
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
       b.company_id
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

CREATE OR REPLACE FUNCTION public.record_expense_bill_payment(
  p_bill_id         UUID,
  p_amount          NUMERIC,
  p_bank_account_id UUID,
  p_payment_date    DATE DEFAULT CURRENT_DATE,
  p_created_by      TEXT DEFAULT NULL
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
    || ' against invoice ' || v_bill.bill_number;
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

ALTER TABLE public.expense_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_expense_bills" ON public.expense_bills;
DROP POLICY IF EXISTS "expense_bills_read" ON public.expense_bills;
CREATE POLICY "expense_bills_read"
  ON public.expense_bills
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "expense_bills_insert" ON public.expense_bills;
CREATE POLICY "expense_bills_insert"
  ON public.expense_bills
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.expense_bills TO anon, authenticated;
GRANT SELECT ON public.v_expense_bills_outstanding TO anon, authenticated;

REVOKE ALL ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT)
  TO anon, authenticated;

-- Adamrit's custom User-table login ordinarily reaches data as the anon role.
-- Keep these policies limited to this bucket and this one object prefix.
DROP POLICY IF EXISTS "expense_bill_invoice_insert" ON storage.objects;
CREATE POLICY "expense_bill_invoice_insert"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'expense-bills'
  );

DROP POLICY IF EXISTS "expense_bill_invoice_select" ON storage.objects;
CREATE POLICY "expense_bill_invoice_select"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'expense-bills'
  );

DROP POLICY IF EXISTS "expense_bill_invoice_delete" ON storage.objects;
CREATE POLICY "expense_bill_invoice_delete"
  ON storage.objects
  FOR DELETE
  TO anon, authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'expense-bills'
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
