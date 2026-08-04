-- The signed payment voucher, kept beside the invoice.
--
-- When an expense bill is paid in CASH, the payment voucher is printed and
-- signed by the person receiving the money. That signed paper is the evidence
-- the cash actually went out, so the Pay form now takes a second upload and
-- stores it on the same expense_bills row that already holds the invoice.
--
-- record_expense_bill_payment gains two optional document arguments; when
-- provided it stamps them on the bill in the same transaction as the payment
-- voucher. A later payment with a new signed voucher replaces the previous
-- one (the latest signed paper covers the bill's payment trail).
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS signed_voucher_path TEXT,
  ADD COLUMN IF NOT EXISTS signed_voucher_url  TEXT;

COMMENT ON COLUMN public.expense_bills.signed_voucher_url IS
  'The printed payment voucher signed by the receiver of the funds (uploaded when the bill is paid in cash).';

-- Same view as 20260804250000 plus signed_voucher_url.
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
       COALESCE(NULLIF(btrim(b.point_of_contact), ''), p.point_of_contact)
                                                        AS point_of_contact,
       b.relationship_manager,
       b.patient_name,
       b.patient_type,
       b.revenue_entry_id,
       b.created_at,
       b.signed_voucher_url
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

-- Payment RPC: two optional document arguments appended. Dropped first so the
-- 6-argument signature does not survive as an ambiguous overload.
DROP FUNCTION IF EXISTS public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_expense_bill_payment(
  p_bill_id             UUID,
  p_amount              NUMERIC,
  p_bank_account_id     UUID,
  p_payment_date        DATE DEFAULT CURRENT_DATE,
  p_created_by          TEXT DEFAULT NULL,
  p_remarks             TEXT DEFAULT NULL,
  p_signed_voucher_path TEXT DEFAULT NULL,
  p_signed_voucher_url  TEXT DEFAULT NULL
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

  -- The signed paper voucher, kept beside the invoice on the bill itself.
  IF p_signed_voucher_url IS NOT NULL THEN
    UPDATE public.expense_bills
       SET signed_voucher_path = p_signed_voucher_path,
           signed_voucher_url  = p_signed_voucher_url,
           updated_at = NOW()
     WHERE id = p_bill_id;
  END IF;

  RETURN v_voucher_no;
END;
$$;

REVOKE ALL ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
