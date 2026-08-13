-- The MRI rate ceiling moves from Rs. 3,000 to Rs. 3,500.
--
-- 20260806140000 capped outsourced scan rates at two levels — no CT over 2,500
-- and no MRI over 3,000 — with enforce_diagnostic_test_ceiling() on
-- diagnostic_centre_tests. That cap turned away MRI Fistulogram at 3,500, a
-- rate the scan centres now quote, so the MRI level is lifted to 3,500.
--
-- The CT ceiling is untouched and still bites at 2,500.
--
-- The ceiling is keyed on the word MRI in the test name, so this lifts the
-- level for every MRI at every centre — there is no per-test exception.
--
-- Only the function body changes. CREATE OR REPLACE keeps every trigger
-- already bound to it, so the BEFORE INSERT OR UPDATE trigger on
-- diagnostic_centre_tests picks the new body up without being rebuilt.
--
-- Stored rows need no backfill: the trigger only fires on write, and no
-- seeded MRI rate is above 3,000.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent — re-running replaces the function with the same body.

CREATE OR REPLACE FUNCTION public.enforce_diagnostic_test_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_name TEXT := upper(btrim(NEW.test_name));
BEGIN
  IF v_name ~ '\mMRI\M' AND NEW.amount > 3500 THEN
    RAISE EXCEPTION 'No MRI can be more than Rs. 3,500 (% is %)', NEW.test_name, NEW.amount;
  END IF;
  IF v_name ~ '\mCT\M' AND NEW.amount > 2500 THEN
    RAISE EXCEPTION 'No CT scan can be more than Rs. 2,500 (% is %)', NEW.test_name, NEW.amount;
  END IF;
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------
-- Proof. Each probe writes inside its own block and is rolled back to the
-- implicit savepoint, so no real rate is left changed.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_mri TEXT;
  v_ct  TEXT;
BEGIN
  SELECT test_name INTO v_mri FROM public.diagnostic_centre_tests
   WHERE upper(btrim(test_name)) ~ '\mMRI\M' LIMIT 1;
  SELECT test_name INTO v_ct FROM public.diagnostic_centre_tests
   WHERE upper(btrim(test_name)) ~ '\mCT\M' LIMIT 1;
  IF v_mri IS NULL OR v_ct IS NULL THEN
    RAISE EXCEPTION 'no MRI/CT rate to probe the ceilings with';
  END IF;

  -- 1. An MRI at exactly 3,500 now passes.
  BEGIN
    UPDATE public.diagnostic_centre_tests SET amount = 3500 WHERE test_name = v_mri;
    RAISE EXCEPTION 'rollback_probe';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'rollback_probe' THEN
        RAISE EXCEPTION 'MRI at 3,500 is still refused: %', SQLERRM;
      END IF;
  END;

  -- 2. An MRI over the new ceiling is still refused.
  BEGIN
    UPDATE public.diagnostic_centre_tests SET amount = 3501 WHERE test_name = v_mri;
    RAISE EXCEPTION 'verification did not reach the MRI ceiling';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%No MRI can be more than Rs. 3,500%' THEN
        RAISE EXCEPTION 'unexpected guard at the MRI ceiling: %', SQLERRM;
      END IF;
  END;

  -- 3. The CT ceiling was not disturbed.
  BEGIN
    UPDATE public.diagnostic_centre_tests SET amount = 2600 WHERE test_name = v_ct;
    RAISE EXCEPTION 'verification did not reach the CT ceiling';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%No CT scan can be more than Rs. 2,500%' THEN
        RAISE EXCEPTION 'unexpected guard at the CT ceiling: %', SQLERRM;
      END IF;
  END;

  RAISE NOTICE 'OK — MRI ceiling now 3,500, CT ceiling still 2,500';
END;
$verify$;
