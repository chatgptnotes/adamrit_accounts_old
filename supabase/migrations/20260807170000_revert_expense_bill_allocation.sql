-- Undo "Move to Daily Allocation".
--
-- The move creates two rows: an inactive execution-record obligation and the
-- daily_payment_schedule row that shows on Today's Allocation. Reverting takes
-- both away again, so the invoice returns to the register unallocated and can
-- be moved to a different day.
--
-- Refused once money has moved. If the schedule row is paid or skipped, or any
-- payment has been posted against the invoice, the allocation is history and
-- deleting it would orphan a voucher — the caller is told the bill is paid
-- rather than the row quietly disappearing.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE OR REPLACE FUNCTION public.revert_expense_bill_allocation(
  p_bill_id UUID,
  p_user    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_bill RECORD;
  v_schedule RECORD;
  v_paid NUMERIC(15,2);
  v_others INTEGER;
BEGIN
  SELECT b.*, p.account_name AS party_name
    INTO v_bill
    FROM public.expense_bills b
    JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
   WHERE b.id = p_bill_id
   FOR UPDATE OF b;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reverted', false, 'reason', 'That invoice no longer exists');
  END IF;

  -- Anything already paid against this invoice, by the same bill_ref match the
  -- register nets with.
  SELECT COALESCE(SUM(e.debit_amount), 0) INTO v_paid
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id
   WHERE e.account_id = v_bill.party_ledger_id
     AND btrim(COALESCE(e.bill_ref, '')) = btrim(v_bill.bill_number)
     AND v.company_id IS NOT DISTINCT FROM v_bill.company_id
     AND v.status = 'AUTHORISED'
     AND e.debit_amount > 0;

  IF v_paid > 0.005 THEN
    RETURN jsonb_build_object(
      'reverted', false, 'paid', true,
      'reason', 'Invoice ' || v_bill.bill_number || ' has been paid and cannot be reverted');
  END IF;

  SELECT s.* INTO v_schedule
    FROM public.daily_payment_schedule s
   WHERE s.expense_bill_id = p_bill_id
     AND s.status NOT IN ('paid', 'skipped')
   ORDER BY s.schedule_date DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.daily_payment_schedule
                WHERE expense_bill_id = p_bill_id AND status = 'paid') THEN
      RETURN jsonb_build_object(
        'reverted', false, 'paid', true,
        'reason', 'Invoice ' || v_bill.bill_number || ' has been paid and cannot be reverted');
    END IF;
    RETURN jsonb_build_object(
      'reverted', false,
      'reason', 'Invoice ' || v_bill.bill_number || ' is not on any allocation');
  END IF;

  IF COALESCE(v_schedule.paid_amount, 0) > 0.005 THEN
    RETURN jsonb_build_object(
      'reverted', false, 'paid', true,
      'reason', 'Invoice ' || v_bill.bill_number || ' has been part paid and cannot be reverted');
  END IF;

  DELETE FROM public.daily_payment_schedule WHERE id = v_schedule.id;

  -- The execution-record obligation exists only to carry this one allocation.
  -- Remove it too, unless some other schedule row still points at it.
  IF v_schedule.obligation_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_others
      FROM public.daily_payment_schedule
     WHERE obligation_id = v_schedule.obligation_id;
    IF v_others = 0 THEN
      DELETE FROM public.payment_obligations
       WHERE id = v_schedule.obligation_id
         AND is_active = false
         AND COALESCE(notes, '') LIKE 'DAILY_ALLOCATION_EXECUTION:%';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'reverted', true,
    'bill_number', v_bill.bill_number,
    'party', v_bill.party_name,
    'schedule_date', v_schedule.schedule_date,
    'by', COALESCE(NULLIF(btrim(p_user), ''), 'expense-bills')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_expense_bill_allocation(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revert_expense_bill_allocation(UUID, TEXT)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'revert_expense_bill_allocation'
  ) THEN
    RAISE EXCEPTION 'ABORT: revert_expense_bill_allocation was not created';
  END IF;
  RAISE NOTICE 'OK — an unpaid allocation can be sent back to the register';
END $$;
