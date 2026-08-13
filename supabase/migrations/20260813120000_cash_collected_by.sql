-- Who physically took the cash, and which handover has claimed it.
--
-- Neither fact is recorded anywhere today. advance_payment.created_by is NULL
-- on every row (AdvancePaymentModal hardcodes it, the tablet flows omit it),
-- and billing_executive is free text that only two of the five insert paths
-- populate -- 386 of the last 1,354 cash receipts name nobody at all. So
-- "how much cash is with this cashier" is currently unanswerable.
--
-- collected_by_user_id is a real FK, not a reuse of created_by: that column is
-- free text already carrying 'system', 'canteen-sonu' and 'quick-pay-avni',
-- so it can never be joined to a person.
--
-- cash_handover_id is the claim link. A cash receipt belongs to at most one
-- handover, for ever. Claiming receipts rather than summing per person is what
-- lets the figure stay correct where nobody was recorded -- final bills and
-- every row written before today.

ALTER TABLE public.advance_payment
  ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES public."User"(id),
  ADD COLUMN IF NOT EXISTS cash_handover_id UUID;

ALTER TABLE public.final_payments
  ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES public."User"(id),
  ADD COLUMN IF NOT EXISTS cash_handover_id UUID;

ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS collected_by_user_id UUID REFERENCES public."User"(id),
  ADD COLUMN IF NOT EXISTS cash_handover_id UUID;

-- "Unclaimed cash" is the hot query behind every screen in this feature, so it
-- gets a partial index rather than a scan. Mode is compared upper-cased
-- throughout because the vasooli tile writes 'Cash' while everything else
-- writes 'CASH' -- an = 'CASH' filter silently drops those collections.
CREATE INDEX IF NOT EXISTS advance_payment_cash_unclaimed_idx
  ON public.advance_payment (payment_date DESC)
  WHERE cash_handover_id IS NULL
    AND upper(btrim(payment_mode)) = 'CASH'
    AND COALESCE(is_refund, false) = false;

CREATE INDEX IF NOT EXISTS advance_payment_collected_by_idx
  ON public.advance_payment (collected_by_user_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS final_payments_cash_unclaimed_idx
  ON public.final_payments (payment_date DESC)
  WHERE cash_handover_id IS NULL
    AND upper(btrim(mode_of_payment)) = 'CASH';

CREATE INDEX IF NOT EXISTS pharmacy_sales_cash_unclaimed_idx
  ON public.pharmacy_sales (sale_date DESC)
  WHERE cash_handover_id IS NULL
    AND upper(btrim(payment_method)) = 'CASH';

COMMENT ON COLUMN public.advance_payment.collected_by_user_id IS
  'The logged-in user who took this payment. Stamped from useAuth() at every insert site.';
COMMENT ON COLUMN public.advance_payment.cash_handover_id IS
  'Set once, when a cash handover claims this receipt. NULL means still in the drawer.';

DO $verify$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(t.tbl || '.' || t.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('advance_payment','collected_by_user_id'), ('advance_payment','cash_handover_id'),
    ('final_payments','collected_by_user_id'),  ('final_payments','cash_handover_id'),
    ('pharmacy_sales','collected_by_user_id'),  ('pharmacy_sales','cash_handover_id')
  ) AS t(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = t.tbl AND c.column_name = t.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: columns were not created: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'advance_payment_cash_unclaimed_idx'
  ) THEN
    RAISE EXCEPTION 'ABORT: the unclaimed-cash index was not created';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
