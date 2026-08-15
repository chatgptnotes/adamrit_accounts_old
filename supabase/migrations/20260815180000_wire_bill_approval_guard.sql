-- Payment refuses an unapproved bill, and the register can see the approval.
--
-- 20260815160000 installed the approval, the approver list and
-- expense_bill_payment_blocked(), but nothing CALLED the guard -- so switching
-- enforcement on would have changed precisely nothing. This wires it into
-- record_expense_bill_payment, at the only safe place: after the bill is read,
-- before a single row is written, in the same transaction as the click.
--
-- Everything else in the function is byte-for-byte the current definition. The
-- only additions are the v_blocked declaration and the six lines that use it.

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
  v_blocked     TEXT;
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

  -- Approval, checked here: after the bill is read and before a single row is
  -- written, in the same transaction as the click. A refusal therefore reaches
  -- the screen whole and costs a message, not a posting.
  v_blocked := public.expense_bill_payment_blocked(p_bill_id);
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION '%', v_blocked;
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

NOTIFY pgrst, 'reload schema';
