-- Fix: every Daily Allocation payment fails with
--      'record "v_inv" is not assigned yet'.
--
-- create_daily_payment_voucher loads the surgery invoice into a RECORD only
-- when the schedule row carries an approval_queue_id, but later tested:
--
--     IF v_schedule.approval_queue_id IS NOT NULL AND v_inv.id IS NOT NULL
--
-- PL/pgSQL evaluates that whole boolean as one expression, so `v_inv.id` is
-- read even when the left side is false — and on an unassigned RECORD that
-- raises. Result: paying ANY ordinary obligation (no surgery invoice behind
-- it) aborted, which is most of the allocation. Reported on the Gaurav
-- Euphoria row.
--
-- The record is now tracked with a plain boolean set where it is actually
-- loaded. Everything else in the function is unchanged.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_daily_payment_voucher(
  p_schedule_id UUID,
  p_amount NUMERIC,
  p_user_id TEXT DEFAULT NULL,
  p_payee_name TEXT DEFAULT NULL,
  p_hospital_type TEXT DEFAULT 'hope',
  p_company_id UUID DEFAULT NULL,
  p_debit_account_id UUID DEFAULT NULL,
  p_credit_account_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_schedule       RECORD;
  v_bill           RECORD;
  v_inv            RECORD;
  v_bill_ref       TEXT := NULL;
  v_inv_found      BOOLEAN := false;
  v_payment_id     UUID;
  v_payment_number TEXT;
  v_outstanding    NUMERIC;
  v_new_paid       NUMERIC;
  v_person_name    TEXT;
  v_company_id     UUID;
  v_debit_id       UUID;
  v_credit_id      UUID;
  v_type_id        UUID;
  v_type_code      TEXT;
  v_voucher_id     UUID;
  v_voucher_no     TEXT;
  v_narration      TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  SELECT * INTO v_schedule
    FROM public.daily_payment_schedule
   WHERE id = p_schedule_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule record not found';
  END IF;

  v_outstanding := greatest(
    coalesce(v_schedule.daily_amount, 0)
      + coalesce(v_schedule.carryforward_amount, 0)
      - coalesce(v_schedule.paid_amount, 0), 0
  );
  IF p_amount > v_outstanding THEN
    RAISE EXCEPTION 'Payment amount exceeds the outstanding amount of %', v_outstanding;
  END IF;

  -- Fall back to whatever the schedule row carries, so an older caller that
  -- passes only the original five arguments still posts when the row is mapped.
  v_company_id := coalesce(p_company_id, v_schedule.accounting_company_id);
  v_debit_id   := coalesce(p_debit_account_id, v_schedule.debit_account_id);
  v_credit_id  := coalesce(p_credit_account_id, v_schedule.credit_account_id);

  IF v_debit_id IS NULL OR v_credit_id IS NULL THEN
    RAISE EXCEPTION 'Select the ledger being paid and the cash or bank it is paid from before confirming';
  END IF;
  IF v_debit_id = v_credit_id THEN
    RAISE EXCEPTION 'The paid ledger and the cash or bank account cannot be the same';
  END IF;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Select the accounting company before confirming';
  END IF;

  -- An allocation that pays a specific invoice must actually pay it: same
  -- party ledger, same company, never more than the invoice still owes.
  IF v_schedule.expense_bill_id IS NOT NULL THEN
    SELECT b.bill_number, b.party_ledger_id, b.company_id, b.status,
           b.amount - COALESCE(paid.amount, 0) AS due
      INTO v_bill
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
     WHERE b.id = v_schedule.expense_bill_id;
    IF FOUND THEN
      IF v_bill.status <> 'POSTED' THEN
        RAISE EXCEPTION 'Invoice % has been cancelled and cannot be paid', v_bill.bill_number;
      END IF;
      IF v_debit_id <> v_bill.party_ledger_id THEN
        RAISE EXCEPTION 'This allocation pays invoice % — the paid ledger must stay the invoice''s supplier',
          v_bill.bill_number;
      END IF;
      IF v_company_id IS DISTINCT FROM v_bill.company_id THEN
        RAISE EXCEPTION 'This allocation pays invoice % — it must be paid from the invoice''s company',
          v_bill.bill_number;
      END IF;
      IF p_amount > COALESCE(v_bill.due, 0) + 0.005 THEN
        RAISE EXCEPTION 'Only % is still outstanding on invoice %',
          to_char(COALESCE(v_bill.due, 0), 'FM99,99,99,990.00'), v_bill.bill_number;
      END IF;
      v_bill_ref := v_bill.bill_number;
    END IF;
  END IF;

  -- An allocation that pays a surgery invoice (Specialist Payouts) must pay
  -- the invoice's doctor from the invoice's company, and only once.
  IF v_schedule.approval_queue_id IS NOT NULL THEN
    SELECT q.id, q.invoice_no, q.reference_no, q.party_name, q.party_account_id,
           q.company_id, q.status, q.is_paid
      INTO v_inv
      FROM public.approval_queue q
     WHERE q.id = v_schedule.approval_queue_id
     FOR UPDATE OF q;
    IF FOUND THEN
      v_inv_found := true;
      IF v_inv.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Invoice % is no longer approved and cannot be paid',
          COALESCE(v_inv.invoice_no, v_inv.reference_no, '');
      END IF;
      -- A partial payment through THIS schedule row already claimed the
      -- invoice; only a payment from somewhere else blocks it.
      IF v_inv.is_paid AND COALESCE(v_schedule.paid_amount, 0) = 0 THEN
        RAISE EXCEPTION 'Invoice % was already paid from the Specialist Payouts screen',
          COALESCE(v_inv.invoice_no, v_inv.reference_no, '');
      END IF;
      IF v_debit_id <> v_inv.party_account_id THEN
        RAISE EXCEPTION 'This allocation pays invoice % — the paid ledger must stay %''s ledger',
          COALESCE(v_inv.invoice_no, v_inv.reference_no, ''), v_inv.party_name;
      END IF;
      IF v_company_id IS DISTINCT FROM v_inv.company_id THEN
        RAISE EXCEPTION 'This allocation pays invoice % — it must be paid from the invoice''s company',
          COALESCE(v_inv.invoice_no, v_inv.reference_no, '');
      END IF;
      v_bill_ref := COALESCE(NULLIF(btrim(v_inv.invoice_no), ''), v_inv.reference_no);
    END IF;
  END IF;

  v_payment_number := public.generate_voucher_number('PV');
  v_person_name := coalesce(nullif(btrim(p_payee_name), ''), v_schedule.party_name);

  INSERT INTO public.payment_vouchers (
    voucher_no, voucher_date, person_name, amount, purpose, paid_by,
    hospital_type, daily_payment_schedule_id
  ) VALUES (
    v_payment_number, v_schedule.schedule_date, v_person_name, p_amount,
    'Daily payment allocation - ' || v_schedule.category,
    coalesce(nullif(btrim(p_user_id), ''), 'daily-payment-allocation'),
    coalesce(nullif(btrim(p_hospital_type), ''), 'hope'), p_schedule_id
  ) RETURNING id INTO v_payment_id;

  v_new_paid := coalesce(v_schedule.paid_amount, 0) + p_amount;
  UPDATE public.daily_payment_schedule
     SET paid_amount = v_new_paid,
         status = CASE WHEN v_new_paid >= coalesce(daily_amount, 0) + coalesce(carryforward_amount, 0)
                       THEN 'paid' ELSE 'partial' END,
         paid_at = now(),
         paid_by = p_user_id,
         accounting_company_id = v_company_id,
         debit_account_id = v_debit_id,
         credit_account_id = v_credit_id,
         updated_at = now()
   WHERE id = p_schedule_id;

  -- The accounting side. Payment vouchers on both sides draw from the same PV
  -- sequence, so the operational voucher and its ledger entry carry adjacent
  -- numbers rather than two unrelated ones.
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PV' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  v_narration := 'Daily payment allocation - ' || v_person_name
                 || CASE WHEN v_bill_ref IS NOT NULL THEN ', invoice ' || v_bill_ref ELSE '' END
                 || ' , payment voucher ' || v_payment_number;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := public.generate_voucher_number(v_type_code);

  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id, v_schedule.schedule_date,
    v_payment_id::TEXT, v_narration, p_amount, v_company_id, 'AUTHORISED',
    coalesce(nullif(btrim(p_user_id), ''), 'daily-payment-allocation'), now(), now()
  );

  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debit_id,  v_narration, p_amount, 0, 1, v_bill_ref, now()),
    (gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, p_amount, 2, NULL, now());

  -- Settle the surgery invoice the moment its allocation pays anything: the
  -- claim keeps the Specialist Payouts screen from paying it a second time,
  -- and any remainder stays tracked on this schedule row alone.
  IF v_inv_found THEN
    UPDATE public.approval_queue
       SET is_paid = true,
           paid_at = COALESCE(paid_at, now()),
           payment_voucher_id = COALESCE(payment_voucher_id, v_voucher_id)
     WHERE id = v_schedule.approval_queue_id;
  END IF;

  RETURN jsonb_build_object(
    'paymentVoucherId',     v_payment_id,
    'paymentVoucherNumber', v_payment_number,
    'accountingVoucherId',     v_voucher_id,
    'accountingVoucherNumber', v_voucher_no
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_daily_payment_voucher(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_daily_payment_voucher(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID, UUID, UUID) TO anon, authenticated;

-- Proof: calling with a nonexistent schedule must now fail on the SCHEDULE
-- check ('Schedule record not found'), never on an unassigned record.
DO $verify$
BEGIN
  PERFORM public.create_daily_payment_voucher(
    '00000000-0000-0000-0000-000000000000'::uuid, 1, 'verify', NULL, 'hope', NULL, NULL, NULL);
  RAISE EXCEPTION 'verification did not reach the expected guard';
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE '%not assigned yet%' THEN
      RAISE EXCEPTION 'STILL BROKEN: %', SQLERRM;
    END IF;
    RAISE NOTICE 'OK — guard reached cleanly: %', SQLERRM;
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%not assigned yet%' THEN
      RAISE EXCEPTION 'STILL BROKEN: %', SQLERRM;
    END IF;
    RAISE NOTICE 'OK — no unassigned-record error (%)', SQLERRM;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
