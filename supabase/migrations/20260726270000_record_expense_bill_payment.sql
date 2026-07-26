-- Settle an expense bill, and tie the payment to the invoice it pays.
--
-- The payment posts Dr party / Cr bank-or-cash, carrying the invoice number in
-- bill_ref on the party line. That is Tally's Agst Ref, and it is what lets
-- v_expense_bills_outstanding net the payment against the accrual so the bill
-- shows as settled or part paid.
--
-- Done in the database rather than the client so a voucher can never be left
-- half written: the header, both legs and the validation happen in one
-- transaction, or none of it does.

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
  v_outstanding NUMERIC(15,2);
  v_type_id     UUID;
  v_type_code   TEXT;
  v_voucher_id  UUID;
  v_voucher_no  TEXT;
  v_party_name  TEXT;
  v_narration   TEXT;
BEGIN
  SELECT b.*, p.account_name AS party_name
    INTO v_bill
    FROM expense_bills b
    JOIN chart_of_accounts p ON p.id = b.party_ledger_id
   WHERE b.id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice no longer exists';
  END IF;

  IF v_bill.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Invoice % has been cancelled and cannot be paid', v_bill.bill_number;
  END IF;

  -- What is genuinely left, computed from the ledger rather than from a status
  -- flag someone has to remember to update.
  SELECT b.amount - COALESCE(paid.amount, 0)
    INTO v_outstanding
    FROM expense_bills b
    LEFT JOIN LATERAL (
      SELECT sum(e.debit_amount) AS amount
        FROM voucher_entries e
        JOIN vouchers v ON v.id = e.voucher_id
       WHERE e.account_id = b.party_ledger_id
         AND btrim(COALESCE(e.bill_ref, '')) = btrim(b.bill_number)
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

  IF p_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Choose the account the money is paid from';
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 WHEN 'PV' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  v_party_name := v_bill.party_name;
  v_narration  := 'Payment to ' || v_party_name || ' against invoice ' || v_bill.bill_number;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id, p_payment_date, v_bill.bill_number,
    v_narration, p_amount, v_bill.company_id, 'AUTHORISED',
    COALESCE(p_created_by, 'expense-bill-payment'), NOW(), NOW()
  );

  -- bill_ref goes on the party line only. That is the leg the outstanding
  -- calculation matches against; the bank side is not part of the open item.
  INSERT INTO voucher_entries (
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

GRANT EXECUTE ON FUNCTION public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT)
  TO authenticated;
