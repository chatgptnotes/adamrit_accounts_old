-- Catch up the patient ledgers registered since the backfill ran.
--
-- 20260814100000 filled the patient ledgers at 03:31 today by joining
-- account_code to 'PT' || patients_id. It is a one-shot UPDATE, not a trigger,
-- so its coverage decays: every patient registered after it ran has a ledger
-- with no number on it. By this evening 301 of 5,813 patient ledgers were
-- without one, and the gap widens with each registration.
--
-- apply_migration() records a file name and refuses to replay it, so the
-- catch-up needs a file of its own. This is that file, and it will need
-- another until the number is filled in when the ledger is CREATED rather than
-- swept up afterwards. That is the real fix and it is not this script.
--
-- The join is a key, not a name: ledger names in this database differ by
-- punctuation and case, and matching thousands of them by name would sooner or
-- later attach one person's phone number to another person's account.

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

-- Only ledgers that still have nothing. A number already on a ledger is left
-- exactly as it is: if the patient's phone has since been edited, the ledger
-- holds what was true when the voucher was stamped, and quietly rewriting that
-- would change history rather than fill a gap.
CREATE TEMP TABLE _mobile_catchup ON COMMIT DROP AS
WITH filled AS (
  UPDATE public.chart_of_accounts coa
     SET mobile = public.norm_party_mobile(p.phone)
    FROM public.patients p
   WHERE coa.account_code = 'PT' || p.patients_id
     AND coa.mobile IS NULL
     AND public.norm_party_mobile(p.phone) IS NOT NULL
  RETURNING coa.id, coa.account_code, coa.mobile
)
SELECT * FROM filled;

DO $verify$
DECLARE v_wrong INT; v_new INT; v_filled INT; v_pt_total INT; v_pt_left INT; v_drift INT;
BEGIN
  SELECT count(*) INTO v_new FROM _mobile_catchup;

  -- Every number written by THIS run must be the number of the patient whose
  -- UHID is in that ledger's code. This is the check that matters: it would
  -- catch a mis-join even if the update above looked right.
  SELECT count(*) INTO v_wrong
    FROM _mobile_catchup c
    JOIN public.chart_of_accounts coa ON coa.id = c.id
    JOIN public.patients p ON coa.account_code = 'PT' || p.patients_id
   WHERE coa.mobile IS DISTINCT FROM public.norm_party_mobile(p.phone);
  IF v_wrong > 0 THEN
    RAISE EXCEPTION 'ABORT: % ledger(s) were given a number that is not their own', v_wrong;
  END IF;

  -- Ledgers filled by an EARLIER run whose patient has since changed their
  -- phone. Reported, never corrected: see the note on the update above.
  SELECT count(*) INTO v_drift
    FROM public.chart_of_accounts coa
    JOIN public.patients p ON coa.account_code = 'PT' || p.patients_id
   WHERE coa.mobile IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _mobile_catchup c WHERE c.id = coa.id)
     AND coa.mobile IS DISTINCT FROM public.norm_party_mobile(p.phone);

  SELECT count(*) INTO v_filled FROM public.chart_of_accounts WHERE mobile IS NOT NULL;
  SELECT count(*) INTO v_pt_total
    FROM public.chart_of_accounts WHERE account_code LIKE 'PT%';
  SELECT count(*) INTO v_pt_left
    FROM public.chart_of_accounts WHERE account_code LIKE 'PT%' AND mobile IS NULL;

  -- The earlier backfill is already in place, so the total can only go up.
  IF v_filled < 5000 THEN
    RAISE EXCEPTION 'ABORT: only % ledger(s) carry a number; something removed them', v_filled;
  END IF;

  RAISE NOTICE 'Caught up % patient ledger(s). Patient ledgers: % with a number, % still without, of %. Ledgers overall with a number: %. Earlier rows now differing from the patient record: %',
    v_new, v_pt_total - v_pt_left, v_pt_left, v_pt_total, v_filled, v_drift;
END
$verify$;

NOTIFY pgrst, 'reload schema';
