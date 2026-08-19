-- Tell somebody when a medicine falls below its reorder level.
--
-- THE INSTRUCTION (19 Aug, Dr M): a list of commonly used drugs with reorder
-- levels, and "notify if stock is below reorder level". Levels are in TABLETS —
-- "4 strip" is 40 — confirmed by Dr M, so a strip is ten and every level here is
-- a piece count, the same unit the batch inventory counts in.
--
-- THIS MIGRATION IS THE MACHINERY, NOT THE LEVELS. Which master row each of the
-- 21 names refers to is a purchasing decision: fourteen of them are not in
-- medicine_master under the name given, and four match a DIFFERENT BRAND of the
-- same molecule (Atorva 40 against Atovastrin 40, Ondem against Ondemir).
-- Substituting a brand is not a decision to make in a migration, so the levels
-- come in a second script once the names are confirmed. Everything here works
-- the moment any level is set.
--
-- THE COLUMN IS reorder_level. medicine_master has both reorder_level and
-- minimum_stock and both are null on every row. Dr M asked for reorder levels,
-- so reorder_level is the authority; minimum_stock is honoured as a fallback
-- because getLowStockAlerts in the app has always read it, and a level already
-- set there must not be quietly ignored.
--
-- STOCK IS SUMMED BY medicine_id, NOT BY HOSPITAL NAME. This is the fault that
-- has kept the existing low-stock screen empty since it was built.
-- v_medicine_combined_stock records the hospital as 'hope HMIS' on 56 rows and
-- 'Hope Multi-Specialty Hospital' on 32; medicine_master says 'Hope
-- Multi-Specialty Hospital' and 'Ayushman Hospital'; and the app passes
-- hospitalConfig.name, which is 'hope'. getLowStockAlerts filters
-- hospital_name = 'hope' and therefore matches NOTHING, every time, silently.
-- A medicine_id belongs to exactly one master row and therefore one hospital, so
-- summing every stock row for that id is both correct and immune to the
-- spellings. src/lib/batch-inventory-service.ts is corrected alongside this.

-- ------------------------------------------------------- 1. what is short

CREATE OR REPLACE VIEW public.v_medicine_below_reorder AS
SELECT m.id                          AS medicine_id,
       m.medicine_name,
       m.hospital_name,
       m.type,
       COALESCE(s.total_stock, 0)    AS stock,
       -- reorder_level leads; minimum_stock is honoured where it is the only
       -- level anyone has set.
       COALESCE(NULLIF(m.reorder_level, 0), NULLIF(m.minimum_stock, 0)) AS reorder_level,
       COALESCE(NULLIF(m.reorder_level, 0), NULLIF(m.minimum_stock, 0))
         - COALESCE(s.total_stock, 0) AS shortfall,
       s.nearest_expiry
  FROM public.medicine_master m
  LEFT JOIN (
    SELECT medicine_id, sum(total_stock) AS total_stock, min(nearest_expiry) AS nearest_expiry
      FROM public.v_medicine_combined_stock
     GROUP BY medicine_id
  ) s ON s.medicine_id = m.id
 WHERE COALESCE(m.is_deleted, false) = false
   -- A medicine with no level set is not short; it is unmanaged, and saying
   -- otherwise would report the whole master as an emergency on day one.
   AND COALESCE(NULLIF(m.reorder_level, 0), NULLIF(m.minimum_stock, 0)) IS NOT NULL
   AND COALESCE(s.total_stock, 0)
       <= COALESCE(NULLIF(m.reorder_level, 0), NULLIF(m.minimum_stock, 0));

COMMENT ON VIEW public.v_medicine_below_reorder IS
  'Medicines at or below their reorder level, in pieces. Stock is summed by '
  'medicine_id because hospital_name is spelled three ways across these tables.';

GRANT SELECT ON public.v_medicine_below_reorder TO anon, authenticated;

-- --------------------------------------------------------- 2. tell somebody

CREATE OR REPLACE FUNCTION public.notify_low_stock_medicines()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows   INT := 0;
  v_lines  TEXT;
  v_out    INT := 0;
BEGIN
  SELECT count(*),
         string_agg(
           medicine_name || ' — ' || stock || ' left, reorder at ' || reorder_level,
           E'\n' ORDER BY shortfall DESC, medicine_name)
    INTO v_rows, v_lines
    FROM public.v_medicine_below_reorder;

  IF COALESCE(v_rows, 0) = 0 THEN
    RETURN 0;
  END IF;

  -- ONE DIGEST A DAY, not one bell per drug. Twenty-one separate notifications
  -- is how a real shortage gets scrolled past; the ghost cash alerts of 17-Aug
  -- were the same lesson.
  IF EXISTS (
    SELECT 1 FROM notifications
     WHERE notification_type = 'medicine_low_stock'
       AND created_at > now() - interval '20 hours'
  ) THEN
    RETURN 0;
  END IF;

  BEGIN
    INSERT INTO notifications (notification_type, title, message, recipient_role,
                               source_table, payload)
    VALUES ('medicine_low_stock',
            v_rows || ' medicine(s) at or below reorder level',
            v_lines,
            'all', 'medicine_master',
            jsonb_build_object('count', v_rows));
    v_out := 1;
  EXCEPTION WHEN OTHERS THEN
    -- Never let a failed notification take the check down with it, but never
    -- swallow it either: it is reported in the log for the next reader.
    RAISE WARNING 'Low-stock digest could not be written: %', SQLERRM;
  END;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.notify_low_stock_medicines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_low_stock_medicines() TO anon, authenticated;

-- Once a morning, 09:00 IST (03:30 UTC), before the day's ordering.
SELECT cron.unschedule('medicine-low-stock')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'medicine-low-stock');

SELECT cron.schedule(
  'medicine-low-stock',
  '30 3 * * *',
  $cron$ SELECT public.notify_low_stock_medicines(); $cron$
);

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE
  v_id UUID; v_before INT; v_after INT; v_second INT; v_listed INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'medicine-low-stock') THEN
    RAISE EXCEPTION 'ABORT: the daily check is not scheduled';
  END IF;

  -- A medicine with no level must NOT be reported, or the first run names the
  -- entire master.
  SELECT count(*) INTO v_listed
    FROM public.v_medicine_below_reorder b
    JOIN public.medicine_master m ON m.id = b.medicine_id
   WHERE COALESCE(NULLIF(m.reorder_level, 0), NULLIF(m.minimum_stock, 0)) IS NULL;
  IF v_listed > 0 THEN
    RAISE EXCEPTION 'ABORT: % medicine(s) with no reorder level are being reported as short', v_listed;
  END IF;

  -- End to end, on a real master row, then put it back.
  SELECT id INTO v_id FROM public.medicine_master
   WHERE COALESCE(is_deleted, false) = false
     AND reorder_level IS NULL AND minimum_stock IS NULL
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'No unlevelled medicine to self-test with — machinery installed, not exercised';
    RETURN;
  END IF;

  SELECT count(*) INTO v_before FROM notifications WHERE notification_type = 'medicine_low_stock';

  UPDATE public.medicine_master SET reorder_level = 999999 WHERE id = v_id;
  IF NOT EXISTS (SELECT 1 FROM public.v_medicine_below_reorder WHERE medicine_id = v_id) THEN
    UPDATE public.medicine_master SET reorder_level = NULL WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: a medicine below its level is not reported';
  END IF;

  PERFORM public.notify_low_stock_medicines();
  SELECT count(*) INTO v_after FROM notifications WHERE notification_type = 'medicine_low_stock';

  -- Twice in a day must be once.
  PERFORM public.notify_low_stock_medicines();
  SELECT count(*) INTO v_second FROM notifications WHERE notification_type = 'medicine_low_stock';

  UPDATE public.medicine_master SET reorder_level = NULL WHERE id = v_id;
  DELETE FROM notifications
   WHERE notification_type = 'medicine_low_stock' AND created_at > now() - interval '5 minutes';

  IF v_after <= v_before THEN
    RAISE EXCEPTION 'ABORT: the digest was not written (% then %)', v_before, v_after;
  END IF;
  IF v_second <> v_after THEN
    RAISE EXCEPTION 'ABORT: a second run wrote a second bell for the same day';
  END IF;

  IF EXISTS (SELECT 1 FROM public.medicine_master WHERE id = v_id AND reorder_level IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORT: the self-test left its reorder level behind';
  END IF;

  RAISE NOTICE 'Low-stock alerts work end to end, and repeat runs stay quiet';
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it
-- Nothing is short yet because no level is set anywhere. This is the count that
-- should be zero today and non-zero once the levels are loaded.

SELECT (SELECT count(*) FROM public.medicine_master
         WHERE COALESCE(is_deleted, false) = false)              AS medicines_in_master,
       (SELECT count(*) FROM public.medicine_master
         WHERE COALESCE(NULLIF(reorder_level, 0), NULLIF(minimum_stock, 0)) IS NOT NULL
           AND COALESCE(is_deleted, false) = false)              AS with_a_reorder_level,
       (SELECT count(*) FROM public.v_medicine_below_reorder)     AS below_reorder_now;
