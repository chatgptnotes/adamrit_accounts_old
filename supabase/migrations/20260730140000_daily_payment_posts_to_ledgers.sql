-- Daily Payment Allocation posts to the ledgers again.
--
-- 20260728170000_daily_payment_voucher_only.sql stripped the accounting entry
-- out of this flow, leaving only the operational payment_vouchers row. The
-- consequence was that money went out of the bank and the day book never knew:
-- PV-000289 (MSEDCL, Rs 25,000, 30 July) exists, its ledger entry does not.
--
-- So the payment posts again, as an ordinary Payment voucher:
--
--     Dr  <the party being paid>      the amount
--         Cr  <the cash or bank paid from>   same amount
--
-- Both ledgers now come from the caller rather than from whatever happened to
-- be stored on the obligation. The Pay dialog already asks for both and will
-- not confirm without them, so an unposted payment is no longer reachable from
-- the screen. The operational voucher is still created first and is still what
-- the schedule links to; the accounting voucher references it, which is also
-- what makes a re-run idempotent.

-- The five-argument version is dropped rather than left in place: with the new
-- arguments defaulted, a five-argument call would be ambiguous between the two.
DROP FUNCTION IF EXISTS public.create_daily_payment_voucher(UUID, NUMERIC, TEXT, TEXT, TEXT);

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
    entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, v_debit_id,  v_narration, p_amount, 0, 1, now()),
    (gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, p_amount, 2, now());

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

-- Payments already made through the operational-only version, so you can see
-- what has no ledger entry behind it and decide whether to journalise it by hand.
SELECT pv.voucher_no, pv.voucher_date, pv.person_name, pv.amount
  FROM public.payment_vouchers pv
 WHERE pv.daily_payment_schedule_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.vouchers v
      WHERE v.reference_number = pv.id::TEXT AND v.status <> 'CANCELLED')
 ORDER BY pv.voucher_date DESC, pv.voucher_no DESC;
