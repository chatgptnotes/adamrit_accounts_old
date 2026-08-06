-- The remaining common procedures Hope sends out, and what the centre is paid.
--
--   Colour Doppler - Single Limb   2,500
--   Colour Doppler - Both Limbs    5,000
--   2D Echo Doppler                1,500
--
-- Added at both scan centres alongside the CT / MRI / ultrasound card loaded
-- by 20260806140000. Seed only — a rate already edited at a centre is left
-- alone. The CT / MRI ceilings do not apply to Doppler.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

DO $rates$
DECLARE
  v_centre UUID;
  v_c      TEXT;
  v_t      TEXT;
  v_centres TEXT[] := ARRAY['Nobal Scan Center', 'INSIGHT SCAN CENTER'];
  v_rates   JSONB  := jsonb_build_object(
    'Colour Doppler - Single Limb', 2500,
    'Colour Doppler - Both Limbs',  5000,
    '2D Echo Doppler',              1500
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
     AND lower(btrim(c.name)) IN ('nobal scan center', 'insight scan center')
     AND lower(btrim(t.test_name)) IN (
       'colour doppler - single limb', 'colour doppler - both limbs', '2d echo doppler');
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'expected 3 Doppler rates at each scan centre, found %', v_count;
  END IF;
  RAISE NOTICE 'OK — Doppler rates loaded at both scan centres';
END;
$verify$;
