-- Referral invoices on the Daily Allocation now say WHO they are for.
--
-- A moved M.L. Enterprises referral invoice used to appear as just
-- "M.L. Enterprises" — indistinguishable from every other referral invoice,
-- and unfindable by the RM's name (Ruby looked for "Sandeep Meshram" and
-- could not tell which row was his ₹700). The schedule row's display label
-- now carries the patient and RM: "M.L. Enterprises · Pappu Sen (RM SANDEEP
-- MESHRAM)". The obligation keeps the clean party name, so ledger mapping is
-- unchanged; only the visible label (and the payment narration built from
-- it) gains the context.
--
-- Run in the Supabase dashboard SQL Editor AFTER 20260804310000. Safe twice.

BEGIN;

CREATE OR REPLACE FUNCTION public.move_expense_bill_to_daily_allocation(
  p_bill_id    UUID,
  p_date       DATE DEFAULT CURRENT_DATE,
  p_created_by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill          RECORD;
  v_outstanding   NUMERIC(15,2);
  v_hospital      TEXT;
  v_label         TEXT;
  v_obligation_id UUID;
  v_schedule_id   UUID;
  v_existing      RECORD;
BEGIN
  SELECT b.*, p.account_name AS party_name, c.company_key
    INTO v_bill
    FROM public.expense_bills b
    JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
    LEFT JOIN public.companies c ON c.id = b.company_id
   WHERE b.id = p_bill_id
   FOR UPDATE OF b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice no longer exists';
  END IF;
  IF v_bill.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Invoice % has been cancelled', v_bill.bill_number;
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
  IF COALESCE(v_outstanding, 0) <= 0.005 THEN
    RAISE EXCEPTION 'Invoice % is already fully paid', v_bill.bill_number;
  END IF;

  SELECT s.id, s.schedule_date INTO v_existing
    FROM public.daily_payment_schedule s
   WHERE s.expense_bill_id = p_bill_id
     AND s.status NOT IN ('paid', 'skipped')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Invoice % is already on the % allocation',
      v_bill.bill_number, to_char(v_existing.schedule_date, 'DD Mon YYYY');
  END IF;

  v_hospital := CASE WHEN v_bill.company_key = 'ayushman_nagpur' THEN 'ayushman' ELSE 'hope' END;

  -- Referral invoices carry the patient and the manager; put them on the
  -- label so the allocation list reads like the report it came from.
  v_label := v_bill.party_name
    || COALESCE(' · ' || NULLIF(btrim(v_bill.patient_name), ''), '')
    || COALESCE(' (RM ' || NULLIF(btrim(v_bill.relationship_manager), '') || ')', '');

  INSERT INTO public.payment_obligations (
    party_name, category, sub_category, default_daily_amount, priority,
    company_id, chart_of_accounts_id, is_active, hospital_name, notes
  ) VALUES (
    v_bill.party_name, 'variable', 'other', v_outstanding, 10,
    v_bill.company_id, v_bill.party_ledger_id, false, v_hospital,
    'DAILY_ALLOCATION_EXECUTION:' || p_date::TEXT
  ) RETURNING id INTO v_obligation_id;

  INSERT INTO public.daily_payment_schedule (
    schedule_date, obligation_id, party_name, category, daily_amount,
    carryforward_amount, paid_amount, status, hospital_name,
    accounting_company_id, debit_account_id, expense_bill_id, notes
  ) VALUES (
    p_date, v_obligation_id, v_label, 'variable', v_outstanding,
    0, 0, 'pending', v_hospital,
    v_bill.company_id, v_bill.party_ledger_id, p_bill_id,
    'DAILY_ALLOCATION_SENT:Invoice ' || v_bill.bill_number || ' — ' || v_label
      || COALESCE(' (' || NULLIF(btrim(p_created_by), '') || ')', '')
  ) RETURNING id INTO v_schedule_id;

  RETURN jsonb_build_object(
    'schedule_id', v_schedule_id,
    'schedule_date', p_date,
    'bill_number', v_bill.bill_number,
    'party', v_label,
    'amount', v_outstanding,
    'hospital', v_hospital
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_expense_bill_to_daily_allocation(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_expense_bill_to_daily_allocation(UUID, DATE, TEXT) TO anon, authenticated;

-- Relabel the referral rows already sitting on a live allocation, so today's
-- two M.L. Enterprises rows become tellable-apart immediately.
UPDATE public.daily_payment_schedule s
   SET party_name = p.account_name
       || COALESCE(' · ' || NULLIF(btrim(b.patient_name), ''), '')
       || COALESCE(' (RM ' || NULLIF(btrim(b.relationship_manager), '') || ')', ''),
       updated_at = now()
  FROM public.expense_bills b
  JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
 WHERE s.expense_bill_id = b.id
   AND s.status NOT IN ('paid', 'skipped')
   AND (b.patient_name IS NOT NULL OR b.relationship_manager IS NOT NULL);

NOTIFY pgrst, 'reload schema';

COMMIT;
