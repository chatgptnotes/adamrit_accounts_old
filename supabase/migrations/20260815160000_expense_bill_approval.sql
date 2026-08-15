-- Bills are approved by Dr Murali before they can be paid.
--
-- WHERE THE GATE SITS, AND WHY NOT AT CREATION
--
-- On payment, not on raising the bill. A bill that cannot be RAISED stops the
-- diagnostics desk, the referral rail and the supplier clerk dead, and the
-- work still has to be recorded somewhere. A bill that cannot be PAID stops
-- exactly one thing: money leaving without Dr Murali having seen it. That is
-- what "approved by Dr Murali" asks for.
--
-- record_expense_bill_payment raises before it writes anything, in the same
-- transaction as the click, so the refusal reaches the screen and nothing is
-- half-done. That distinction is not theoretical -- yesterday's mobile rule
-- was checked at COMMIT on a rail that writes in two transactions, and instead
-- of refusing entries it silently destroyed four postings.
--
-- WHO PREPARED THE BILL is already recorded: expense_bills.created_by, filled
-- on all 217 rows. It holds the login, and that is the uncomfortable part --
-- 148 of 217 say superadmin@hospital.com. Two thirds of bills are prepared
-- under a shared account, so the field answers "which login" and not "which
-- person". No column can fix that; individual logins can. Recorded here so the
-- gap is on the record rather than assumed solved.
--
-- EVERY EXISTING BILL IS GRANDFATHERED, and marked as such rather than left
-- looking personally approved. 213 of the 217 were raised this month and many
-- are already paid; freezing live payables to collect retrospective approvals
-- would stop the hospital paying its suppliers for work already done.
--
-- OFF BY DEFAULT. Switching it on is Dr M's decision, not a side effect of
-- installing it, and after today it should be a deliberate one:
--
--   ON   UPDATE public.expense_bill_approval_settings SET enforced = true  WHERE id;
--   OFF  UPDATE public.expense_bill_approval_settings SET enforced = false WHERE id;

-- 1. Who may approve. A table, not a hard-coded id, because one approver who
--    is travelling means nothing gets paid. Seeded with BOTH of Dr Murali's
--    logins -- drmurali@gmail.com and cmd@hopehospital.com are two separate
--    accounts, and seeding only one would leave him unable to approve from the
--    other.
CREATE TABLE IF NOT EXISTS public.expense_bill_approvers (
  user_id    UUID PRIMARY KEY REFERENCES public."User"(id),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

ALTER TABLE public.expense_bill_approvers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_bill_approvers_read ON public.expense_bill_approvers;
CREATE POLICY expense_bill_approvers_read
  ON public.expense_bill_approvers FOR SELECT USING (true);

INSERT INTO public.expense_bill_approvers (user_id, note)
SELECT id, 'Dr Murali'
  FROM public."User"
 WHERE lower(btrim(email)) IN ('drmurali@gmail.com', 'cmd@hopehospital.com')
ON CONFLICT (user_id) DO NOTHING;

-- 2. The approval itself.
ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS approved_by      UUID REFERENCES public."User"(id),
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note    TEXT;

COMMENT ON COLUMN public.expense_bills.approved_by IS
  'Dr Murali, or another named approver. NULL means unapproved: the bill can '
  'be raised and posted, but not paid once enforcement is on.';

-- 3. Grandfather what already exists, visibly.
UPDATE public.expense_bills
   SET approved_at = COALESCE(approved_at, created_at),
       approved_by_name = COALESCE(approved_by_name,
         'Grandfathered — raised before approval was introduced, 15 Aug 2026')
 WHERE approved_at IS NULL;

-- 4. The switch.
CREATE TABLE IF NOT EXISTS public.expense_bill_approval_settings (
  id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enforced   BOOLEAN NOT NULL DEFAULT false,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.expense_bill_approval_settings (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.expense_bill_approval_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_bill_approval_settings_read ON public.expense_bill_approval_settings;
CREATE POLICY expense_bill_approval_settings_read
  ON public.expense_bill_approval_settings FOR SELECT USING (true);

-- 5. Approving.
CREATE OR REPLACE FUNCTION public.approve_expense_bill(
  p_bill_id UUID, p_user_id UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT; v_no TEXT; v_already TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Sign in before approving'; END IF;

  IF NOT EXISTS (SELECT 1 FROM expense_bill_approvers WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Only Dr Murali may approve a bill for payment';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_name FROM "User" WHERE id = p_user_id;

  SELECT bill_number, approved_at INTO v_no, v_already
    FROM expense_bills WHERE id = p_bill_id FOR UPDATE;
  IF v_no IS NULL THEN RAISE EXCEPTION 'That bill no longer exists'; END IF;

  -- Approving twice is not an error worth stopping anybody for, but it must
  -- not overwrite who approved it first.
  IF v_already IS NOT NULL AND EXISTS (
       SELECT 1 FROM expense_bills WHERE id = p_bill_id AND approved_by IS NOT NULL) THEN
    RETURN jsonb_build_object('billNumber', v_no, 'alreadyApproved', true);
  END IF;

  UPDATE expense_bills
     SET approved_by = p_user_id,
         approved_by_name = v_name,
         approved_at = now(),
         approval_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_bill_id;

  RETURN jsonb_build_object('billNumber', v_no, 'approvedBy', v_name, 'alreadyApproved', false);
END $$;

REVOKE ALL ON FUNCTION public.approve_expense_bill(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_expense_bill(UUID, UUID, TEXT) TO anon, authenticated;

-- 6. The gate, at the top of payment, before a single row is written.
CREATE OR REPLACE FUNCTION public.expense_bill_payment_blocked(p_bill_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok BOOLEAN; v_appr UUID; v_at TIMESTAMPTZ; v_no TEXT;
BEGIN
  IF NOT COALESCE((SELECT enforced FROM expense_bill_approval_settings WHERE id), false) THEN
    RETURN NULL;
  END IF;
  SELECT bill_number, approved_by, approved_at INTO v_no, v_appr, v_at
    FROM expense_bills WHERE id = p_bill_id;
  IF v_at IS NOT NULL THEN RETURN NULL; END IF;
  RETURN format('Bill %s has not been approved by Dr Murali. Nothing has been paid — '
                'ask for approval and pay again.', COALESCE(v_no, ''));
END $$;

REVOKE ALL ON FUNCTION public.expense_bill_payment_blocked(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expense_bill_payment_blocked(UUID) TO anon, authenticated;

DO $verify$
DECLARE
  v_murali UUID; v_other UUID; v_bill UUID; v_ok BOOLEAN; v_res JSONB;
  v_was BOOLEAN; v_n INT; v_msg TEXT;
BEGIN
  SELECT enforced INTO v_was FROM expense_bill_approval_settings WHERE id;

  -- (a) both of Dr Murali's logins may approve; nobody else may.
  SELECT count(*) INTO v_n FROM expense_bill_approvers;
  IF v_n < 2 THEN
    RAISE EXCEPTION 'ABORT: only % approver(s) seeded; both of Dr Murali''s logins are needed', v_n;
  END IF;
  SELECT user_id INTO v_murali FROM expense_bill_approvers LIMIT 1;
  SELECT id INTO v_other FROM public."User"
   WHERE id NOT IN (SELECT user_id FROM expense_bill_approvers) LIMIT 1;

  -- (b) every existing bill is grandfathered, so no live payable is frozen.
  SELECT count(*) INTO v_n FROM expense_bills WHERE approved_at IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % existing bill(s) left unapproved', v_n;
  END IF;

  -- A bill of our own to test with, so no real payable is touched.
  INSERT INTO expense_bills (bill_number, bill_date, amount, narration, status,
                             company_id, expense_ledger_id, party_ledger_id, created_by)
  SELECT 'SELFTEST-APPR', CURRENT_DATE, 1, 'self test', 'POSTED',
         b.company_id, b.expense_ledger_id, b.party_ledger_id, 'self test'
    FROM expense_bills b WHERE b.expense_ledger_id IS NOT NULL LIMIT 1
  RETURNING id INTO v_bill;
  IF v_bill IS NULL THEN RAISE EXCEPTION 'ABORT: could not make a test bill'; END IF;
  UPDATE expense_bills SET approved_at = NULL, approved_by_name = NULL WHERE id = v_bill;

  -- (c) OFF: an unapproved bill is payable. This is the state we leave behind.
  UPDATE expense_bill_approval_settings SET enforced = false WHERE id;
  IF expense_bill_payment_blocked(v_bill) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: payment blocked while enforcement is off';
  END IF;

  -- (d) ON: it is refused, by name.
  UPDATE expense_bill_approval_settings SET enforced = true WHERE id;
  v_msg := expense_bill_payment_blocked(v_bill);
  IF v_msg IS NULL OR v_msg NOT LIKE '%not been approved by Dr Murali%' THEN
    RAISE EXCEPTION 'ABORT: an unapproved bill was payable with enforcement on';
  END IF;

  -- (e) somebody who is not an approver cannot approve it
  v_ok := false;
  BEGIN
    PERFORM approve_expense_bill(v_bill, v_other, 'should fail');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%Only Dr Murali%');
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: a bill was approved by somebody who is not an approver';
  END IF;

  -- (f) Dr Murali can, and then it is payable
  v_res := approve_expense_bill(v_bill, v_murali, 'self test');
  IF (v_res->>'alreadyApproved')::boolean THEN
    RAISE EXCEPTION 'ABORT: the first approval reported itself as a repeat';
  END IF;
  IF expense_bill_payment_blocked(v_bill) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: an approved bill is still blocked';
  END IF;

  -- (g) approving again does not rewrite who approved it first
  v_res := approve_expense_bill(v_bill, v_murali, 'again');
  IF NOT (v_res->>'alreadyApproved')::boolean THEN
    RAISE EXCEPTION 'ABORT: a second approval overwrote the first';
  END IF;

  DELETE FROM expense_bills WHERE id = v_bill;
  UPDATE expense_bill_approval_settings SET enforced = COALESCE(v_was, false) WHERE id;
  IF COALESCE((SELECT enforced FROM expense_bill_approval_settings WHERE id), false) THEN
    RAISE EXCEPTION 'ABORT: this migration must not leave enforcement on';
  END IF;
  IF EXISTS (SELECT 1 FROM expense_bills WHERE bill_number = 'SELFTEST-APPR') THEN
    RAISE EXCEPTION 'ABORT: the self-test bill was left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
