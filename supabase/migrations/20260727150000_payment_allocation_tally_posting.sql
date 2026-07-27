-- Preserve the exact Tally company and both sides of a payment selected for
-- each daily schedule row. The accounting IDs remain derived from the linked
-- Tally records when the voucher is posted.

ALTER TABLE public.daily_payment_schedule
  ADD COLUMN IF NOT EXISTS tally_company_id UUID REFERENCES public.tally_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tally_ledger_id UUID REFERENCES public.tally_ledgers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_tally_ledger_id UUID REFERENCES public.tally_ledgers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_payment_schedule_tally_company
  ON public.daily_payment_schedule(tally_company_id);

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS tally_company_id UUID REFERENCES public.tally_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS debit_tally_ledger_id UUID REFERENCES public.tally_ledgers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credit_tally_ledger_id UUID REFERENCES public.tally_ledgers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vouchers_tally_company
  ON public.vouchers(tally_company_id);

CREATE OR REPLACE FUNCTION public.mark_obligation_paid(
  p_schedule_id UUID,
  p_amount      NUMERIC,
  p_user_id     TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_schedule           RECORD;
  v_voucher_id         UUID;
  v_voucher_number     TEXT;
  v_debit_account_id   UUID;
  v_credit_account_id  UUID;
  v_new_paid           NUMERIC(12,2);
  v_new_status         TEXT;
  v_type_id            UUID;
  v_company_id         UUID;
  v_narration          TEXT;
  v_debit_company_id   UUID;
  v_credit_company_id  UUID;
BEGIN
  SELECT * INTO v_schedule
    FROM public.daily_payment_schedule
   WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule record not found';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  -- New payments must identify both Tally sides. Legacy rows can still use
  -- their existing mapped expense and Cash in Hand fallback.
  IF v_schedule.tally_ledger_id IS NOT NULL THEN
    SELECT tl.accounting_account_id, tl.accounting_company_id
      INTO v_debit_account_id, v_debit_company_id
      FROM public.tally_ledgers tl
     WHERE tl.id = v_schedule.tally_ledger_id
       AND (v_schedule.tally_company_id IS NULL OR tl.company_id = v_schedule.tally_company_id);
    IF v_debit_account_id IS NULL THEN
      RAISE EXCEPTION 'Selected debit Tally ledger is not linked to an accounting ledger';
    END IF;
  END IF;

  IF v_schedule.credit_tally_ledger_id IS NOT NULL THEN
    SELECT tl.accounting_account_id, tl.accounting_company_id
      INTO v_credit_account_id, v_credit_company_id
      FROM public.tally_ledgers tl
     WHERE tl.id = v_schedule.credit_tally_ledger_id
       AND (v_schedule.tally_company_id IS NULL OR tl.company_id = v_schedule.tally_company_id)
       AND (
         lower(coalesce(tl.parent_group, '')) LIKE '%cash%'
         OR lower(coalesce(tl.parent_group, '')) LIKE '%bank%'
       );
    IF v_credit_account_id IS NULL THEN
      RAISE EXCEPTION 'Selected credit ledger is not a linked Cash or Bank ledger';
    END IF;
  END IF;

  IF v_debit_account_id IS NULL THEN
    SELECT po.chart_of_accounts_id INTO v_debit_account_id
      FROM public.payment_obligations po
     WHERE po.id = v_schedule.obligation_id;
  END IF;
  IF v_debit_account_id IS NULL THEN
    SELECT id INTO v_debit_account_id
      FROM public.chart_of_accounts
     WHERE account_name ILIKE '%expense%' OR account_type IN ('EXPENSES', 'DIRECT_EXPENSES', 'INDIRECT_EXPENSES')
     LIMIT 1;
  END IF;

  IF v_credit_account_id IS NULL THEN
    SELECT id INTO v_credit_account_id
      FROM public.chart_of_accounts
     WHERE account_name = 'Cash in Hand'
     LIMIT 1;
  END IF;

  SELECT id INTO v_type_id
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 ELSE 2 END
   LIMIT 1;

  SELECT accounting_company_id INTO v_company_id
    FROM public.tally_config
   WHERE id = v_schedule.tally_company_id;
  v_company_id := COALESCE(v_company_id, v_schedule.company_id,
    public.resolve_patient_company(v_schedule.hospital_name, NULL));

  v_voucher_number := public.generate_voucher_number(
    COALESCE((SELECT voucher_type_code FROM public.voucher_types WHERE id = v_type_id), 'PAY')
  );
  v_narration := 'Obligation payment ' || v_voucher_number
    || ' - ' || v_schedule.party_name
    || COALESCE(' (' || NULLIF(btrim(v_schedule.category), '') || ')', '')
    || ' for ' || v_schedule.schedule_date;

  INSERT INTO public.vouchers (
    voucher_number, voucher_type_id, voucher_date, total_amount, narration,
    company_id, tally_company_id, debit_tally_ledger_id, credit_tally_ledger_id,
    status, created_by, reference_number
  ) VALUES (
    v_voucher_number, v_type_id, v_schedule.schedule_date, p_amount, v_narration,
    v_company_id, v_schedule.tally_company_id, v_schedule.tally_ledger_id,
    v_schedule.credit_tally_ledger_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(p_user_id), ''), 'obligation-payment'),
    'OBL-' || p_schedule_id::TEXT
  ) RETURNING id INTO v_voucher_id;

  IF v_debit_account_id IS NOT NULL THEN
    INSERT INTO public.voucher_entries
      (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES
      (v_voucher_id, v_debit_account_id, p_amount, 0,
       v_schedule.party_name || ' - ' || v_narration, 1);
  END IF;

  IF v_credit_account_id IS NOT NULL THEN
    INSERT INTO public.voucher_entries
      (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES
      (v_voucher_id, v_credit_account_id, 0, p_amount,
       'Paid from selected Cash/Bank ledger - ' || v_narration, 9999);
  END IF;

  v_new_paid := coalesce(v_schedule.paid_amount, 0) + p_amount;
  IF v_new_paid >= (coalesce(v_schedule.daily_amount, 0) + coalesce(v_schedule.carryforward_amount, 0)) THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE public.daily_payment_schedule
     SET paid_amount = v_new_paid, status = v_new_status,
         voucher_id = v_voucher_id, paid_at = now(),
         paid_by = p_user_id, updated_at = now()
   WHERE id = p_schedule_id;

  RETURN v_voucher_id;
END;
$function$;
