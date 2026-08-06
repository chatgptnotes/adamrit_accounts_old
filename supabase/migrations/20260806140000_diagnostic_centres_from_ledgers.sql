-- Diagnostic centres are chosen from the chart of ledgers, not typed.
--
-- record_diagnostic_referral() finds the centre's creditor ledger by matching
-- diagnostic_centres.name against chart_of_accounts.account_name in the
-- posting company, and CREATES a fresh "DIAG…" ledger when nothing matches.
-- So a typed name that differs by one letter from the real ledger silently
-- opens a duplicate creditor. The seeded centre was "Noble Scan Center"; the
-- real ledger in both books is "Nobal Scan Center" — one referral away from
-- that duplicate.
--
-- This migration:
--   1. adds diagnostic_centres.ledger_account_id -> chart_of_accounts(id),
--   2. corrects the seeded centre to the real ledger name,
--   3. seeds the other three centres Hope sends work to, each by ledger name.
--
-- The name stays the operative field (that is what the RPC matches on); the
-- ledger id records which ledger the master was pointed at. Both are set from
-- the DRM Hope Private Limited books, the company Hope referrals post to.
--
-- It also loads the agreed scan rates and caps them: no CT above 2,500 and no
-- MRI above 3,000, at any centre. Anything at or below the cap is editable.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

-- ------------------------------------------------------------------
-- 1. The link to the chart of accounts
-- ------------------------------------------------------------------
ALTER TABLE public.diagnostic_centres
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES public.chart_of_accounts(id);

CREATE INDEX IF NOT EXISTS idx_diagnostic_centres_ledger
  ON public.diagnostic_centres (ledger_account_id) WHERE ledger_account_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. + 3. Point every centre at a real ledger, by exact ledger name
-- ------------------------------------------------------------------
DO $seed$
DECLARE
  v_company UUID;
  v_ledger  UUID;
  v_name    TEXT;
  v_names   TEXT[] := ARRAY[
    'Nobal Scan Center',        -- CT / MRI
    'INSIGHT SCAN CENTER',      -- CT / MRI
    'LIFE LINE PATH LAB',       -- third-party lab
    'Amapath Pathalogy'         -- lab work Hope does not run in-house
  ];
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'drm_pvt_ltd';
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'DRM Hope Private Limited is not configured';
  END IF;

  -- The seeded centre was a misspelling of the Nobal ledger. Rename rather
  -- than deactivate-and-insert so the row keeps its id (and its tests).
  UPDATE public.diagnostic_centres
     SET name = 'Nobal Scan Center'
   WHERE lower(btrim(name)) = 'noble scan center';

  FOREACH v_name IN ARRAY v_names LOOP
    SELECT id INTO v_ledger
      FROM public.chart_of_accounts
     WHERE company_id = v_company
       AND is_active
       AND lower(btrim(account_name)) = lower(btrim(v_name))
     ORDER BY account_code
     LIMIT 1;
    IF v_ledger IS NULL THEN
      RAISE EXCEPTION 'No active ledger named "%" in the DRM Hope books', v_name;
    END IF;

    INSERT INTO public.diagnostic_centres (name, ledger_account_id)
    SELECT v_name, v_ledger
    WHERE NOT EXISTS (
      SELECT 1 FROM public.diagnostic_centres
       WHERE lower(btrim(name)) = lower(btrim(v_name)) AND is_active
    );

    UPDATE public.diagnostic_centres
       SET ledger_account_id = v_ledger
     WHERE lower(btrim(name)) = lower(btrim(v_name))
       AND is_active
       AND ledger_account_id IS DISTINCT FROM v_ledger;
  END LOOP;
END;
$seed$;

-- ------------------------------------------------------------------
-- 4. Scan rate ceilings — no CT over 2,500, no MRI over 3,000.
--    Word-boundary matching so "CONTRAST" and the like are not read as CT.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_diagnostic_test_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_name TEXT := upper(btrim(NEW.test_name));
BEGIN
  IF v_name ~ '\mMRI\M' AND NEW.amount > 3000 THEN
    RAISE EXCEPTION 'No MRI can be more than Rs. 3,000 (% is %)', NEW.test_name, NEW.amount;
  END IF;
  IF v_name ~ '\mCT\M' AND NEW.amount > 2500 THEN
    RAISE EXCEPTION 'No CT scan can be more than Rs. 2,500 (% is %)', NEW.test_name, NEW.amount;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_diagnostic_test_ceiling ON public.diagnostic_centre_tests;
CREATE TRIGGER enforce_diagnostic_test_ceiling
  BEFORE INSERT OR UPDATE OF test_name, amount ON public.diagnostic_centre_tests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_diagnostic_test_ceiling();

-- ------------------------------------------------------------------
-- 5. The agreed scan rates, at both scan centres. Labs get no scan rates.
-- ------------------------------------------------------------------
DO $rates$
DECLARE
  v_centre UUID;
  v_c      TEXT;
  v_t      TEXT;
  v_centres TEXT[] := ARRAY['Nobal Scan Center', 'INSIGHT SCAN CENTER'];
  v_rates   JSONB  := jsonb_build_object(
    'CT Abdomen and Pelvis',    2000,
    'CT Brain Plain',           1500,
    'CT Brain with Contrast',   2000,
    'MRI Brain',                2000,
    'MRI Brain with Contrast',  2500,
    'MRI Spine',                2500,
    'MRI Spine with Contrast',  3000,
    'Ultrasound',                900
  );
BEGIN
  FOREACH v_c IN ARRAY v_centres LOOP
    SELECT id INTO v_centre FROM public.diagnostic_centres
     WHERE lower(btrim(name)) = lower(btrim(v_c)) AND is_active;
    IF v_centre IS NULL THEN
      RAISE EXCEPTION 'Centre "%" was not seeded', v_c;
    END IF;

    FOR v_t IN SELECT jsonb_object_keys(v_rates) LOOP
      -- Seed only. A rate already edited at a centre is left alone.
      INSERT INTO public.diagnostic_centre_tests (centre_id, test_name, amount)
      SELECT v_centre, v_t, (v_rates ->> v_t)::NUMERIC
      WHERE NOT EXISTS (
        SELECT 1 FROM public.diagnostic_centre_tests
         WHERE centre_id = v_centre
           AND lower(btrim(test_name)) = lower(btrim(v_t))
           AND is_active
      );
    END LOOP;
  END LOOP;
END;
$rates$;

-- ------------------------------------------------------------------
-- 6. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_unlinked INT;
  v_stale    INT;
  v_seeded   INT;
  v_rates    INT;
BEGIN
  SELECT count(*) INTO v_unlinked
    FROM public.diagnostic_centres WHERE is_active AND ledger_account_id IS NULL;
  IF v_unlinked > 0 THEN
    RAISE EXCEPTION '% active centre(s) still have no ledger', v_unlinked;
  END IF;

  -- Every centre name must equal its ledger's name, or the RPC will open a
  -- duplicate creditor on the next referral.
  SELECT count(*) INTO v_stale
    FROM public.diagnostic_centres c
    JOIN public.chart_of_accounts a ON a.id = c.ledger_account_id
   WHERE c.is_active
     AND lower(btrim(c.name)) <> lower(btrim(a.account_name));
  IF v_stale > 0 THEN
    RAISE EXCEPTION '% centre name(s) do not match their ledger', v_stale;
  END IF;

  SELECT count(*) INTO v_seeded FROM public.diagnostic_centres
   WHERE is_active AND lower(btrim(name)) IN (
     'nobal scan center', 'insight scan center', 'life line path lab', 'amapath pathalogy');
  IF v_seeded <> 4 THEN
    RAISE EXCEPTION 'expected the 4 centres, found %', v_seeded;
  END IF;

  -- The ceilings must actually bite.
  BEGIN
    UPDATE public.diagnostic_centre_tests
       SET amount = 2600
     WHERE lower(btrim(test_name)) = 'ct brain plain';
    RAISE EXCEPTION 'verification did not reach the CT ceiling';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%No CT scan can be more than%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
  END;

  SELECT count(*) INTO v_rates FROM public.diagnostic_centre_tests t
    JOIN public.diagnostic_centres c ON c.id = t.centre_id
   WHERE t.is_active AND c.is_active
     AND lower(btrim(c.name)) IN ('nobal scan center', 'insight scan center');
  IF v_rates < 16 THEN
    RAISE EXCEPTION 'expected 8 common procedures at each scan centre, found % in total', v_rates;
  END IF;

  RAISE NOTICE 'OK — 4 centres on real ledgers, % scan rates, CT/MRI ceilings hold', v_rates;
END;
$verify$;
