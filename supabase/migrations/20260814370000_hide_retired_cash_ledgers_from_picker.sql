-- Stop the voucher picker offering cash ledgers that were retired on 2 August.
--
-- The Account field on the Payment Voucher screen searches tally_ledgers and
-- filters on nothing but is_hidden. So "Cash (HOPE)" is still on the list
-- although the ledger behind it was merged into the unified "Cash" on 2 August
-- and deactivated -- and staff keep choosing it, including on all four of the
-- vouchers that went wrong this afternoon.
--
-- The posting no longer cares: payment_voucher_cash_ledger (20260814360000)
-- routes any unresolvable name to the company's own live Cash. So this is not
-- a money fix any more, it is a "stop offering people a retired account" fix.
-- Worth doing anyway -- a picker that lists dead ledgers teaches staff to pick
-- them, and the next rail that reads account_ledger_name may be less forgiving
-- than this one.
--
-- THE RULE IS EVIDENCE, NOT A LIST OF NAMES. A tally ledger is hidden when the
-- books say it was retired and never replaced:
--
--   * a chart_of_accounts ledger called "<name> (merged ...)" exists and is
--     inactive -- so the 2 August merge really did retire this name; and
--   * no ACTIVE chart_of_accounts ledger of that exact name remains anywhere
--     -- so hiding it cannot take away something still in use.
--
-- Scoped to cash and bank groups, because that is what this picker is for
-- ("Cash / Bank ledger — type to search"). The same merge retired hundreds of
-- patient and supplier ledgers on 4 August; those are a separate question and
-- are deliberately left alone here.
--
-- is_hidden, not deleted. The rows keep their history and their ids, every
-- existing payment_voucher_lines row still points at a real ledger, and
-- undoing this is one UPDATE.

DO $apply$
DECLARE v_hidden INT;
BEGIN
  WITH retired AS (
    SELECT tl.id
      FROM public.tally_ledgers tl
     WHERE COALESCE(tl.is_hidden, false) = false
       -- By NAME as well as by group. Tally files "Cash at Almirah" under
       -- Current Assets rather than Cash-in-Hand, and it is plainly a cash
       -- ledger; grouping alone would have missed it. The retired-evidence
       -- test below is what keeps this from over-reaching -- "Tds on Cash Wdl"
       -- matches the name pattern but was never merged, so it stays.
       AND (tl.parent_group ILIKE '%cash%'
            OR tl.parent_group ILIKE '%bank%'
            OR tl.name ILIKE '%cash%'
            OR tl.name ILIKE '%bank%')
       AND EXISTS (
             SELECT 1 FROM public.chart_of_accounts a
              WHERE a.is_active = false
                AND a.account_name ILIKE tl.name || ' (merged%'
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.chart_of_accounts a
              WHERE a.is_active = true
                AND lower(btrim(a.account_name)) = lower(btrim(tl.name))
           )
  )
  UPDATE public.tally_ledgers t
     SET is_hidden = true
    FROM retired r
   WHERE t.id = r.id;

  GET DIAGNOSTICS v_hidden = ROW_COUNT;
  RAISE NOTICE 'Hidden % retired cash/bank ledger(s) from the picker', v_hidden;
END
$apply$;

DO $verify$
DECLARE v_n INT; v_name TEXT;
BEGIN
  -- (a) the one that started this is gone from the picker
  SELECT count(*) INTO v_n FROM public.tally_ledgers
   WHERE name = 'Cash (HOPE)' AND COALESCE(is_hidden, false) = false;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: "Cash (HOPE)" is still offered % time(s)', v_n;
  END IF;

  -- (b) and so is its sibling from the same merge
  SELECT count(*) INTO v_n FROM public.tally_ledgers
   WHERE name = 'Cash at Almirah' AND COALESCE(is_hidden, false) = false;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: "Cash at Almirah" is still offered % time(s)', v_n;
  END IF;

  -- (c) THE ONE THAT MATTERS: the live unified Cash must still be offered, or
  --     this has taken away the only correct choice and left nothing.
  SELECT count(*) INTO v_n FROM public.tally_ledgers
   WHERE name = 'Cash' AND COALESCE(is_hidden, false) = false;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'ABORT: the unified Cash is no longer in the picker';
  END IF;

  -- (d) nothing still live in the books was hidden. This is the check that
  --     would catch the rule being too greedy.
  SELECT count(*), min(tl.name) INTO v_n, v_name
    FROM public.tally_ledgers tl
   WHERE tl.is_hidden = true
     AND EXISTS (SELECT 1 FROM public.chart_of_accounts a
                  WHERE a.is_active = true
                    AND lower(btrim(a.account_name)) = lower(btrim(tl.name)));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % hidden ledger(s) are still active in the books, e.g. "%"', v_n, v_name;
  END IF;

  -- (e) a real bank ledger is untouched, so payments by bank still work
  SELECT count(*) INTO v_n FROM public.tally_ledgers
   WHERE parent_group ILIKE '%bank%' AND COALESCE(is_hidden, false) = false;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'ABORT: no bank ledger is offered any more';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
