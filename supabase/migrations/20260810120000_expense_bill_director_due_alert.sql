-- Tell the director when an expense invoice falls due.
--
-- The Record Invoice form already captures the date the office received the
-- bill and, two months later, the date it should be paid. Nothing read that
-- date, so nobody was ever told. This adds the tick that asks for a reminder,
-- and wires it to the digest that already exists.
--
-- send-payment-deadline-digest WhatsApps the director every unpaid row in
-- payment_deadlines falling due within seven days. Rather than build a second
-- notifier, a ticked invoice writes one row into that table. The new
-- expense_bill_id column is what keeps the two honest:
--
--   * UNIQUE means an invoice can only ever raise one reminder;
--   * paying the bill marks that row paid, so the digest stops nagging about
--     an invoice that has been settled.
--
-- Apply with: python3 scripts/apply-migration.py \
--   supabase/migrations/20260810120000_expense_bill_director_due_alert.sql

ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS notify_director_on_due BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.expense_bills.notify_director_on_due IS
  'Ticked on the Record Invoice form: raise a payment_deadlines row so the director is reminded when date_of_payment falls due.';

ALTER TABLE public.payment_deadlines
  ADD COLUMN IF NOT EXISTS expense_bill_id UUID REFERENCES public.expense_bills(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS payment_deadlines_expense_bill_uniq
  ON public.payment_deadlines (expense_bill_id)
  WHERE expense_bill_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

DO $verify$
DECLARE
  v_flag INTEGER;
  v_link INTEGER;
BEGIN
  SELECT count(*) INTO v_flag
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'expense_bills'
     AND column_name = 'notify_director_on_due';
  IF v_flag <> 1 THEN
    RAISE EXCEPTION 'notify_director_on_due was not added';
  END IF;

  SELECT count(*) INTO v_link
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'payment_deadlines'
     AND column_name = 'expense_bill_id';
  IF v_link <> 1 THEN
    RAISE EXCEPTION 'payment_deadlines.expense_bill_id was not added';
  END IF;

  RAISE NOTICE 'Director due-alert columns in place.';
END
$verify$;
