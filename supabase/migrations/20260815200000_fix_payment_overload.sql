-- Undo my overload, and put the approval guard on the function actually used.
--
-- 20260815180000 rebuilt record_expense_bill_payment FROM AN OLD MIGRATION
-- FILE. The live function had gained two arguments since -- p_signed_voucher_path
-- and p_signed_voucher_url -- so instead of replacing it I created a SECOND,
-- six-argument overload beside the eight-argument one. PostgREST then could not
-- choose between them and every payment failed outright:
--
--     Could not choose the best candidate function between: ...
--
-- Two faults in one, and the second is worse than the first: the guard I added
-- went onto the overload nobody calls, so approval was never enforced on the
-- real path. Enforcement has been ON since this morning and was doing nothing.
--
-- THE LESSON, WRITTEN DOWN BECAUSE I HAVE NOW MADE IT ONCE: reconstruct a
-- function from pg_get_functiondef against the LIVE database, never from the
-- migration that last touched it. A migration file is what the function looked
-- like on the day it was written, not what it is.
--
-- This drops the six-argument overload and rebuilds the eight-argument one
-- exactly as it stands in the database today, with the guard added.

DROP FUNCTION IF EXISTS public.record_expense_bill_payment(UUID, NUMERIC, UUID, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_expense_bill_payment(p_bill_id uuid, p_amount numeric, p_bank_account_id uuid, p_payment_date date DEFAULT CURRENT_DATE, p_created_by text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text, p_signed_voucher_path text DEFAULT NULL::text, p_signed_voucher_url text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Approval. Checked after the bill is read and before a single row is
  -- written, in the same transaction as the click.
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
$function$;


DO $verify$
DECLARE v_n INT; v_def TEXT;
BEGIN
  -- (a) exactly one function of this name, or PostgREST refuses again
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='record_expense_bill_payment';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % overloads remain — payments would still be ambiguous', v_n;
  END IF;

  -- (b) and the one that survives is the eight-argument one, WITH the guard
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='record_expense_bill_payment';
  IF v_def NOT LIKE '%signed_voucher_url%' THEN
    RAISE EXCEPTION 'ABORT: the surviving function is not the one the app calls';
  END IF;
  IF v_def NOT LIKE '%expense_bill_payment_blocked%' THEN
    RAISE EXCEPTION 'ABORT: the surviving function has no approval guard';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
