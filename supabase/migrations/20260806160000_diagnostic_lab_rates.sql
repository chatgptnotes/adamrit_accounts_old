-- What the third-party labs are paid for the work Hope does not run in-house.
--
--   ABG               600
--   Histopathology  3,800
--
-- Loaded at both lab centres (LIFE LINE PATH LAB, Amapath Pathalogy). Seed
-- only — a rate already edited at a centre is left alone. The scan centres
-- keep their own card from 20260806140000 / 150000.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

DO $rates$
DECLARE
  v_centre UUID;
  v_c      TEXT;
  v_t      TEXT;
  v_centres TEXT[] := ARRAY['LIFE LINE PATH LAB', 'Amapath Pathalogy'];
  v_rates   JSONB  := jsonb_build_object(
    'ABG',             600,
    'Histopathology', 3800
  );
BEGIN
  FOREACH v_c IN ARRAY v_centres LOOP
    SELECT id INTO v_centre FROM public.diagnostic_centres
     WHERE lower(btrim(name)) = lower(btrim(v_c)) AND is_active;
    IF v_centre IS NULL THEN
      RAISE EXCEPTION 'Centre "%" is not in the master', v_c;
    END IF;

    FOR v_t IN SELECT jsonb_object_keys(v_rates) LOOP
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

DO $verify$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.diagnostic_centre_tests t
    JOIN public.diagnostic_centres c ON c.id = t.centre_id
   WHERE t.is_active AND c.is_active
     AND lower(btrim(c.name)) IN ('life line path lab', 'amapath pathalogy')
     AND lower(btrim(t.test_name)) IN ('abg', 'histopathology');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'expected ABG + Histopathology at each lab centre, found %', v_count;
  END IF;
  RAISE NOTICE 'OK — lab rates loaded at both third-party labs';
END;
$verify$;
