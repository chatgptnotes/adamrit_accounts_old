-- Allocation payments record which ledger the money came out of.
--
-- THE INSTRUCTION (19 Aug, Dr M): "staff always record the payment source as
-- cash, otherwise the voucher doesn't save — this is a bug, fix it."
--
-- HE IS RIGHT, AND THE BLANK IS NOT THE STAFF. The Payment Voucher screen
-- refuses to save without a paying ledger and writes it on the row
-- (src/pages/PaymentVoucher.tsx:640), so nothing typed by hand can be blank.
-- Every blank comes from create_daily_payment_voucher — the Daily Allocation /
-- Expense Bill / Specialist Payout path. That function is HANDED the paying
-- ledger as p_credit_account_id, resolves it into v_credit_id, credits it in
-- the accounting entry and stores it on daily_payment_schedule.credit_account_id
-- — and then omits account_ledger_name from its INSERT into payment_vouchers
-- (20260805100000:167-176). The column list simply does not mention it.
--
-- WHAT THAT COST. The Cash Book treats a voucher with no paying ledger as "not
-- proven to be cash" and excludes it (isCashPaymentVoucher,
-- src/hooks/usePaymentVouchers.ts:104-110). The books, meanwhile, credit the
-- company's unified Cash for exactly the same row (payment_voucher_cash_ledger
-- path 2, 20260814360000:60-75). So the ledger says cash left the drawer and
-- the Cash Book says nothing did — 47 vouchers, about Rs 7.4 lakh since the
-- July cutover. The owner read it this morning as "no expenses were made at the
-- cash counter" on a day that had them.
--
-- THE BODY IS TAKEN FROM THE LIVE DATABASE, NOT FROM THE MIGRATION FILE.
-- Rule 3 of docs/money-path-rules.md, written after a rebuild from a stale file
-- silently dropped later fixes. pg_get_functiondef is read, patched by exact
-- anchor, and re-executed; if either anchor is not found EXACTLY ONCE the whole
-- thing aborts and nothing changes.
--
-- THE BACKFILL IS NOT A GUESS. The paying ledger of every past allocation
-- payment is on its schedule row (credit_account_id), put there by the same
-- function immediately after the insert. The blank vouchers are filled from
-- that and from nothing else, so a payment made from a bank stays a bank
-- payment and stays out of the cash book. Rows whose schedule has no credit
-- account are LEFT BLANK and reported, because for those the source genuinely
-- is not recorded anywhere and inventing "Cash" would overstate the drawer.

-- ---------------------------------------------------------------- 1. the leak

DO $patch$
DECLARE
  v_src TEXT;
  v_new TEXT;
  v_cols_pat TEXT := 'hospital_type,\s*daily_payment_schedule_id\s*\)\s*VALUES';
  v_vals_pat TEXT := 'p_schedule_id\s*\)\s*RETURNING\s+id\s+INTO\s+v_payment_id;';
  v_n INT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_daily_payment_voucher';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ABORT: create_daily_payment_voucher is not in this database';
  END IF;

  -- Already done. Re-running must be a no-op, not a second patch.
  IF v_src LIKE '%account_ledger_name%' THEN
    RAISE NOTICE 'create_daily_payment_voucher already records account_ledger_name — nothing to do';
    RETURN;
  END IF;

  -- Exactly one insert into payment_vouchers, exactly one column list to widen.
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_src, v_cols_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the payment_vouchers column list matched % times, expected 1 — the live body is not the shape this patch was written for', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM regexp_matches(v_src, v_vals_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the payment_vouchers VALUES list matched % times, expected 1', v_n;
  END IF;

  -- The value is the ledger the accounting entry credits, read from the same
  -- variable, so the two records of one payment cannot drift apart again.
  v_new := regexp_replace(v_src, v_cols_pat,
    'hospital_type, daily_payment_schedule_id, account_ledger_name) VALUES');
  v_new := regexp_replace(v_new, v_vals_pat,
    'p_schedule_id, (SELECT a.account_name FROM public.chart_of_accounts a WHERE a.id = v_credit_id)) RETURNING id INTO v_payment_id;');

  IF v_new = v_src THEN
    RAISE EXCEPTION 'ABORT: the patch changed nothing';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'create_daily_payment_voucher now records the paying ledger on the payment voucher';
END
$patch$;

-- ------------------------------------------------------- 2. the 47 already in

DO $backfill$
DECLARE
  v_before_n INT; v_before_amt NUMERIC;
  v_filled_n INT; v_filled_amt NUMERIC;
  v_left_n INT;   v_left_amt NUMERIC;
BEGIN
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_before_n, v_before_amt
    FROM public.payment_vouchers
   WHERE COALESCE(btrim(account_ledger_name), '') = '';

  RAISE NOTICE 'Before: % voucher(s), Rs %, with no paying ledger recorded',
    v_before_n, to_char(v_before_amt, 'FM99,99,99,990.00');

  WITH filled AS (
    UPDATE public.payment_vouchers pv
       SET account_ledger_name = a.account_name
      FROM public.daily_payment_schedule s
      JOIN public.chart_of_accounts a ON a.id = s.credit_account_id
     WHERE pv.daily_payment_schedule_id = s.id
       AND COALESCE(btrim(pv.account_ledger_name), '') = ''
    RETURNING pv.amount
  )
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_filled_n, v_filled_amt FROM filled;

  SELECT count(*), COALESCE(sum(amount), 0) INTO v_left_n, v_left_amt
    FROM public.payment_vouchers
   WHERE COALESCE(btrim(account_ledger_name), '') = '';

  RAISE NOTICE 'Filled % voucher(s), Rs %, from the ledger their own schedule row records',
    v_filled_n, to_char(v_filled_amt, 'FM99,99,99,990.00');
  RAISE NOTICE 'Left blank on purpose: % voucher(s), Rs % — no credit account on the schedule, so the source is recorded nowhere and must be asked for',
    v_left_n, to_char(v_left_amt, 'FM99,99,99,990.00');
END
$backfill$;

-- ------------------------------------------------------------------ 3. verify

DO $verify$
DECLARE
  v_src TEXT; v_n INT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_daily_payment_voucher';

  IF v_src NOT LIKE '%account_ledger_name%' THEN
    RAISE EXCEPTION 'ABORT: the function still does not record the paying ledger';
  END IF;

  -- The other callers must not have been disturbed: the function still has to
  -- compile and still has to be the one the app calls.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_daily_payment_voucher'
       AND p.pronargs = 8
  ) THEN
    RAISE EXCEPTION 'ABORT: create_daily_payment_voucher no longer takes its 8 arguments — the app call would break';
  END IF;

  -- Nothing may be left blank that its own schedule row could have explained.
  SELECT count(*) INTO v_n
    FROM public.payment_vouchers pv
    JOIN public.daily_payment_schedule s ON s.id = pv.daily_payment_schedule_id
   WHERE COALESCE(btrim(pv.account_ledger_name), '') = ''
     AND s.credit_account_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % allocation voucher(s) are still blank although their schedule names the ledger', v_n;
  END IF;

  -- A hand-written voucher must be unaffected: the screen has always filled
  -- this in, so none of them may have been touched.
  SELECT count(*) INTO v_n
    FROM public.payment_vouchers
   WHERE daily_payment_schedule_id IS NULL
     AND COALESCE(btrim(account_ledger_name), '') = '';
  RAISE NOTICE 'Hand-written vouchers with no ledger (untouched by this script, expected 0): %', v_n;
END
$verify$;

NOTIFY pgrst, 'reload schema';
