-- Give the patient ledgers their mobile numbers.
--
-- Step one (20260814090000) added chart_of_accounts.mobile and filled the 19
-- supplier ledgers that had a number behind them. That left 10,306 ledgers
-- without one, so making the number compulsory would have stopped the counter.
--
-- The patient ledgers turn out to link EXACTLY, not fuzzily. A native patient
-- ledger's account_code is the letters PT followed by the patient's UHID:
--
--     chart_of_accounts.account_code = 'PT' || patients.patients_id
--
-- Measured against live data before writing this: 5,807 PT-coded ledgers, and
-- all 5,807 resolve to a real patient. Not a single miss. 5,783 of those
-- patients have a usable phone number.
--
-- That exactness is the whole point. Ledger names in this database differ by
-- punctuation and case, and matching five thousand of them by name would sooner
-- or later attach one person's phone number to another person's account. This
-- joins on a key instead, so it cannot.
--
-- Still enforces NOTHING. The Tally-imported ledgers (TL-prefixed, 2,331 of
-- them) and the salary and consultant ledgers remain without numbers, so the
-- rule cannot be switched on yet.

-- Refuse to run at all if the key is not unique, rather than let UPDATE ... FROM
-- silently pick one patient out of several for the same ledger.
DO $guard$
DECLARE v_dupes INT;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT coa.id
      FROM public.chart_of_accounts coa
      JOIN public.patients p ON coa.account_code = 'PT' || p.patients_id
     GROUP BY coa.id HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ABORT: % ledger(s) match more than one patient; the UHID is not unique', v_dupes;
  END IF;
END
$guard$;

UPDATE public.chart_of_accounts coa
   SET mobile = public.norm_party_mobile(p.phone)
  FROM public.patients p
 WHERE coa.account_code = 'PT' || p.patients_id
   AND coa.mobile IS NULL
   AND public.norm_party_mobile(p.phone) IS NOT NULL;

DO $verify$
DECLARE v_wrong INT; v_filled INT; v_total INT; v_pt_left INT;
BEGIN
  -- Every number written must be the number of the patient whose UHID is in
  -- that ledger's code. This is the check that matters: it would catch a
  -- mis-join even if the join above looked right.
  SELECT count(*) INTO v_wrong
    FROM public.chart_of_accounts coa
    JOIN public.patients p ON coa.account_code = 'PT' || p.patients_id
   WHERE coa.mobile IS NOT NULL
     AND coa.mobile IS DISTINCT FROM public.norm_party_mobile(p.phone);
  IF v_wrong > 0 THEN
    RAISE EXCEPTION 'ABORT: % patient ledger(s) carry a number that is not their own', v_wrong;
  END IF;

  SELECT count(*) INTO v_filled FROM public.chart_of_accounts WHERE mobile IS NOT NULL;
  SELECT count(*) INTO v_total  FROM public.chart_of_accounts;
  SELECT count(*) INTO v_pt_left
    FROM public.chart_of_accounts
   WHERE account_code LIKE 'PT%' AND mobile IS NULL;

  IF v_filled < 5000 THEN
    RAISE EXCEPTION 'ABORT: only % ledger(s) carry a number; the backfill did not take', v_filled;
  END IF;

  RAISE NOTICE 'Ledgers with a mobile: % of % . Patient ledgers still without one: %',
    v_filled, v_total, v_pt_left;
END
$verify$;

NOTIFY pgrst, 'reload schema';
