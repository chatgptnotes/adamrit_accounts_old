-- daily_payment_schedule.total_due is a GENERATED column, and both move
-- functions shipped today tried to INSERT a value into it, so every move
-- failed with "cannot insert a non-DEFAULT value into column total_due".
-- Caught by the live test of the Expense Bill move (invoice "ds", ₹10).
--
-- Both functions are recreated identically minus total_due in the INSERT —
-- the column computes itself from daily_amount + carryforward_amount.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

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
    p_date, v_obligation_id, v_bill.party_name, 'variable', v_outstanding,
    0, 0, 'pending', v_hospital,
    v_bill.company_id, v_bill.party_ledger_id, p_bill_id,
    'DAILY_ALLOCATION_SENT:Invoice ' || v_bill.bill_number || ' — ' || v_bill.party_name
      || COALESCE(' (' || NULLIF(btrim(p_created_by), '') || ')', '')
  ) RETURNING id INTO v_schedule_id;

  RETURN jsonb_build_object(
    'schedule_id', v_schedule_id,
    'schedule_date', p_date,
    'bill_number', v_bill.bill_number,
    'party', v_bill.party_name,
    'amount', v_outstanding,
    'hospital', v_hospital
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_expense_bill_to_daily_allocation(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_expense_bill_to_daily_allocation(UUID, DATE, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.move_surgery_invoice_to_daily_allocation(
  p_invoice_id UUID,
  p_date       DATE DEFAULT CURRENT_DATE,
  p_created_by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv           RECORD;
  v_invoice_no    TEXT;
  v_hospital      TEXT;
  v_obligation_id UUID;
  v_schedule_id   UUID;
  v_existing      RECORD;
BEGIN
  SELECT q.*, c.company_key
    INTO v_inv
    FROM public.approval_queue q
    LEFT JOIN public.companies c ON c.id = q.company_id
   WHERE q.id = p_invoice_id
   FOR UPDATE OF q;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice no longer exists';
  END IF;

  v_invoice_no := COALESCE(NULLIF(btrim(v_inv.invoice_no), ''), v_inv.reference_no, 'invoice');

  IF v_inv.status <> 'APPROVED' OR v_inv.jv_voucher_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % must be approved (JV posted) before it can go to the daily allocation',
      v_invoice_no;
  END IF;
  IF v_inv.is_paid THEN
    RAISE EXCEPTION 'Invoice % is already paid', v_invoice_no;
  END IF;
  IF v_inv.company_id IS NULL OR v_inv.party_account_id IS NULL THEN
    RAISE EXCEPTION 'Invoice % is missing its company or the doctor''s ledger', v_invoice_no;
  END IF;
  IF COALESCE(v_inv.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice % has no amount', v_invoice_no;
  END IF;

  SELECT s.id, s.schedule_date INTO v_existing
    FROM public.daily_payment_schedule s
   WHERE s.approval_queue_id = p_invoice_id
     AND s.status NOT IN ('paid', 'skipped')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Invoice % is already on the % allocation',
      v_invoice_no, to_char(v_existing.schedule_date, 'DD Mon YYYY');
  END IF;

  v_hospital := CASE WHEN v_inv.company_key = 'ayushman_nagpur' THEN 'ayushman' ELSE 'hope' END;

  INSERT INTO public.payment_obligations (
    party_name, category, sub_category, default_daily_amount, priority,
    company_id, chart_of_accounts_id, is_active, hospital_name, notes
  ) VALUES (
    v_inv.party_name, 'variable', 'other', v_inv.amount, 10,
    v_inv.company_id, v_inv.party_account_id, false, v_hospital,
    'DAILY_ALLOCATION_EXECUTION:' || p_date::TEXT
  ) RETURNING id INTO v_obligation_id;

  INSERT INTO public.daily_payment_schedule (
    schedule_date, obligation_id, party_name, category, daily_amount,
    carryforward_amount, paid_amount, status, hospital_name,
    accounting_company_id, debit_account_id, approval_queue_id, notes
  ) VALUES (
    p_date, v_obligation_id, v_inv.party_name, 'variable', v_inv.amount,
    0, 0, 'pending', v_hospital,
    v_inv.company_id, v_inv.party_account_id, p_invoice_id,
    'DAILY_ALLOCATION_SENT:Invoice ' || v_invoice_no || ' — ' || v_inv.party_name
      || COALESCE(' (' || NULLIF(btrim(p_created_by), '') || ')', '')
  ) RETURNING id INTO v_schedule_id;

  RETURN jsonb_build_object(
    'schedule_id', v_schedule_id,
    'schedule_date', p_date,
    'invoice_no', v_invoice_no,
    'party', v_inv.party_name,
    'amount', v_inv.amount,
    'hospital', v_hospital
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_surgery_invoice_to_daily_allocation(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_surgery_invoice_to_daily_allocation(UUID, DATE, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
