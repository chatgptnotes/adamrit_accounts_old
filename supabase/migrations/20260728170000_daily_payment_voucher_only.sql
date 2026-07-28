-- Daily Payment Allocation creates an operational Payment Voucher only.
-- It must not create a Journal Voucher or any chart-of-accounts posting.

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS daily_payment_schedule_id UUID
    REFERENCES public.daily_payment_schedule(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_vouchers_daily_schedule
  ON public.payment_vouchers(daily_payment_schedule_id, voucher_date DESC);

ALTER TABLE public.payment_sub_allocations
  ADD COLUMN IF NOT EXISTS payment_voucher_id UUID
    REFERENCES public.payment_vouchers(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.create_daily_payment_voucher(
  p_schedule_id UUID,
  p_amount NUMERIC,
  p_user_id TEXT DEFAULT NULL,
  p_payee_name TEXT DEFAULT NULL,
  p_hospital_type TEXT DEFAULT 'hope'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_schedule RECORD;
  v_payment_id UUID;
  v_payment_number TEXT;
  v_outstanding NUMERIC;
  v_new_paid NUMERIC;
  v_person_name TEXT;
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
         updated_at = now()
   WHERE id = p_schedule_id;

  -- No row is inserted into vouchers or voucher_entries here.
  RETURN jsonb_build_object(
    'paymentVoucherId', v_payment_id,
    'paymentVoucherNumber', v_payment_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_daily_payment_voucher(UUID, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_daily_payment_voucher(UUID, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;
