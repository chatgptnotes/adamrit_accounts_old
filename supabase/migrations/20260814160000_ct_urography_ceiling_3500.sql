-- CT Urography may be paid up to Rs. 3,500. Every other CT stays at 2,500.
--
-- 20260806140000 capped outsourced scan rates, and 20260813120000 lifted the
-- MRI level to 3,500 while noting that the ceiling is keyed on the word in the
-- test name, so "there is no per-test exception". This adds the first one.
--
-- CT Urography is a contrast study run over several phases and the centres
-- quote 3,500 for it, so the general CT level turned the rate away and Noble
-- Scan Center could not be paid what it charges.
--
-- Deliberately narrow: it matches CT together with UROGRAPH, so CT Urography
-- is covered and no other CT moves. Note that a test named "CT Urogram" would
-- NOT match and would still cap at 2,500 -- the radiology master holds only
-- "CT Urography", so nothing is missed today, but adding the shorter spelling
-- later would need this widened. The plain
-- "Urography/ Sinography/ Sialography" entry in the radiology master has no CT
-- in its name and was never capped by this trigger at all.
--
-- Only the function body changes. CREATE OR REPLACE keeps the BEFORE INSERT OR
-- UPDATE trigger on diagnostic_centre_tests bound to it.
--
-- The frontend carries the same rule in src/lib/diagnostics/masterTests.ts so
-- the tile can warn before saving; both are changed together, or the screen
-- would refuse a rate the database would have accepted.

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
  -- Checked before the general CT rule, and returns rather than falling
  -- through to it.
  IF v_name ~ '\mCT\M' AND v_name ~ 'UROGRAPH' THEN
    IF NEW.amount > 3500 THEN
      RAISE EXCEPTION 'No CT Urography can be more than Rs. 3,500 (% is %)', NEW.test_name, NEW.amount;
    END IF;
    RETURN NEW;
  END IF;
  IF v_name ~ '\mCT\M' AND NEW.amount > 2500 THEN
    RAISE EXCEPTION 'No CT scan can be more than Rs. 2,500 (% is %)', NEW.test_name, NEW.amount;
  END IF;
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------
-- Proof. No CT Urography rate exists yet, so each probe INSERTS one and is
-- rolled back to the implicit savepoint by raising. Nothing is left behind.
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_centre UUID;
  v_ct TEXT;
BEGIN
  SELECT centre_id INTO v_centre FROM public.diagnostic_centre_tests LIMIT 1;
  IF v_centre IS NULL THEN
    RAISE EXCEPTION 'no diagnostic centre to probe the ceilings with';
  END IF;

  -- 1. CT Urography at exactly 3,500 is now accepted.
  BEGIN
    INSERT INTO public.diagnostic_centre_tests (centre_id, test_name, amount)
    VALUES (v_centre, 'CT Urography', 3500);
    RAISE EXCEPTION 'rollback_probe';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'rollback_probe' THEN
        RAISE EXCEPTION 'CT Urography at 3,500 is still refused: %', SQLERRM;
      END IF;
  END;

  -- 2. Above its own ceiling it is still refused.
  BEGIN
    INSERT INTO public.diagnostic_centre_tests (centre_id, test_name, amount)
    VALUES (v_centre, 'CT Urography', 3501);
    RAISE EXCEPTION 'verification did not reach the CT Urography ceiling';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%No CT Urography can be more than Rs. 3,500%' THEN
        RAISE EXCEPTION 'unexpected guard at the CT Urography ceiling: %', SQLERRM;
      END IF;
  END;

  -- 3. Every other CT is untouched and still bites at 2,500. This is the check
  --    that matters: a careless edit here would have raised the lot.
  BEGIN
    INSERT INTO public.diagnostic_centre_tests (centre_id, test_name, amount)
    VALUES (v_centre, 'CT Abdomen', 2600);
    RAISE EXCEPTION 'verification did not reach the CT ceiling';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%No CT scan can be more than Rs. 2,500%' THEN
        RAISE EXCEPTION 'the general CT ceiling was disturbed: %', SQLERRM;
      END IF;
  END;

  -- 4. And the MRI level is where 20260813120000 left it.
  BEGIN
    INSERT INTO public.diagnostic_centre_tests (centre_id, test_name, amount)
    VALUES (v_centre, 'MRI Brain', 3501);
    RAISE EXCEPTION 'verification did not reach the MRI ceiling';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%No MRI can be more than Rs. 3,500%' THEN
        RAISE EXCEPTION 'the MRI ceiling was disturbed: %', SQLERRM;
      END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.diagnostic_centre_tests WHERE test_name IN ('CT Urography','CT Abdomen','MRI Brain') AND amount IN (3500,3501,2600)) THEN
    RAISE EXCEPTION 'ABORT: a probe row was left behind';
  END IF;

  RAISE NOTICE 'OK - CT Urography 3,500; other CT still 2,500; MRI still 3,500';
END;
$verify$;
