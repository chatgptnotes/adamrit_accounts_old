-- Specialist Payouts flow into the Daily Payment Allocation.
--
-- The Specialist Payouts screen can now tick surgery invoices (surgeon /
-- anesthetist / OT & cath-lab assistant fees) and move them onto a day's
-- allocation, the same way the Expense Bill page moves vendor invoices
-- (20260804210000). The move follows the established pattern: an
-- execution-record obligation (is_active = false, notes
-- DAILY_ALLOCATION_EXECUTION:<date>) plus a daily_payment_schedule row, so
-- Today's Allocation shows the invoice with the doctor's ledger and company
-- pre-mapped, and the generator never recreates it on future dates.
--
-- Only APPROVED, JV-posted, unpaid invoices can move — approval is what posts
-- the liability (Dr fee expense / Cr doctor), so the allocation's payment
-- (Dr doctor / Cr cash-bank) settles it.
--
-- Paying such an allocation marks the approval_queue invoice paid, exactly as
-- the payout screen's own Pay button would — so an invoice can never be paid
-- from both places.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.
-- Requires 20260804210000 (expense_bill_id column and function shape).

BEGIN;

-- ------------------------------------------------------------------
-- 1. The schedule row remembers the surgery invoice it pays
-- ------------------------------------------------------------------
ALTER TABLE public.daily_payment_schedule
  ADD COLUMN IF NOT EXISTS approval_queue_id UUID REFERENCES public.approval_queue(id);

CREATE INDEX IF NOT EXISTS idx_daily_payment_schedule_approval_queue
  ON public.daily_payment_schedule(approval_queue_id) WHERE approval_queue_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. Moving a surgery invoice onto a day's allocation
-- ------------------------------------------------------------------
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

  -- One live allocation per invoice. A paid or skipped row does not block a
  -- second move.
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

  -- Execution record, exactly like the Expense Bill sends: inactive so the
  -- schedule generator never recreates it, but carrying the doctor's ledger
  -- and company so Today's Allocation is pre-mapped for Pay.
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
    carryforward_amount, total_due, paid_amount, status, hospital_name,
    accounting_company_id, debit_account_id, approval_queue_id, notes
  ) VALUES (
    p_date, v_obligation_id, v_inv.party_name, 'variable', v_inv.amount,
    0, v_inv.amount, 0, 'pending', v_hospital,
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

-- ------------------------------------------------------------------
-- 3. Paying such an allocation settles the surgery invoice.
--    Same function as 20260804210000 (expense-bill validation kept intact),
--    with an approval_queue branch: the payment must go to the invoice's
--    doctor from the invoice's company, and posting it marks the invoice
--    paid so the Specialist Payouts screen can never pay it a second time.
-- ------------------------------------------------------------------
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
  IF v_schedule.approval_queue_id IS NOT NULL AND v_inv.id IS NOT NULL THEN
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

NOTIFY pgrst, 'reload schema';

COMMIT;
