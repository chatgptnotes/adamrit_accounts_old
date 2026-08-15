-- The Lab dashboard's results panel, counted from the table that has results.
--
-- It has been reading `test_results`, which does not exist on this database and
-- never has. Supabase reads resolve rather than reject, so the panel showed a
-- confident zero instead of an error: "Tests Completed 0" every day, beside
-- 560,353 real results sitting in lab_results.
--
-- WHY THIS IS AN RPC AND NOT A RENAMED TABLE. Two reasons, both forced:
--
--   1. lab_results.visit_id has NO foreign key, so PostgREST cannot embed
--      visits!inner(patients!inner(...)) the way the old query embedded through
--      lab_orders. There is no join path to the hospital from the client.
--   2. The old query took .limit(1000) and counted the rows it got back. On
--      560,353 results that reports exactly 1000, for ever. Swapping the table
--      name alone would have replaced a wrong zero with a wrong thousand, which
--      is worse -- a zero looks broken, a plausible number does not.
--
-- Counting in SQL fixes both and sends four integers to the browser instead of
-- half a million rows.
--
-- WHAT THE NUMBERS MEAN, measured on today's data rather than assumed:
--
--   * result_status holds exactly two values, 'Final' and 'Preliminary', which
--     is what the dashboard already filters on. Unchanged.
--   * there is no is_critical column. The nearest real column is is_abnormal,
--     and it is FALSE on all 560,353 rows -- nobody populates it. So 'critical'
--     will read 0. That is the honest number; it was 0 before too, but for the
--     wrong reason. Left in place so the day someone starts flagging abnormal
--     results, the card starts working on its own.
--   * 2,429 results point at a visit that no longer exists and 15 have no
--     visit at all. The inner join drops them, because a result that cannot be
--     traced to a patient cannot be attributed to a hospital either.
--   * the split is ayushman 511,846 / hope 46,045.
--
-- No date filter, matching the orders and samples panels beside it. This counts
-- everything, as they do.

CREATE INDEX IF NOT EXISTS lab_results_visit_id_idx
  ON public.lab_results (visit_id);

CREATE OR REPLACE FUNCTION public.lab_result_stats(p_hospital_type TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',    count(*),
    'pending',  count(*) FILTER (WHERE r.result_status = 'Preliminary'),
    'final',    count(*) FILTER (WHERE r.result_status = 'Final'),
    'critical', count(*) FILTER (WHERE r.is_abnormal)
  )
    FROM public.lab_results r
    JOIN public.visits   v ON v.id = r.visit_id
    JOIN public.patients p ON p.id = v.patient_id
   WHERE p_hospital_type IS NULL
      OR lower(btrim(COALESCE(p.hospital_name, ''))) = lower(btrim(p_hospital_type));
$$;

REVOKE ALL ON FUNCTION public.lab_result_stats FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lab_result_stats TO anon, authenticated;

COMMENT ON FUNCTION public.lab_result_stats IS
  'Result counts for the Lab dashboard, per hospital. Counted in SQL because '
  'lab_results has no foreign key to visits, so the client cannot join to the '
  'hospital, and because 560k rows must not be sent to a browser to be counted.';

DO $verify$
DECLARE
  v_all JSONB; v_hope JSONB; v_ayu JSONB;
  v_direct BIGINT; v_started TIMESTAMPTZ; v_ms NUMERIC;
BEGIN
  v_started := clock_timestamp();
  v_all  := lab_result_stats(NULL);
  v_ms   := round(extract(epoch FROM clock_timestamp() - v_started)::numeric * 1000);

  v_hope := lab_result_stats('hope');
  v_ayu  := lab_result_stats('ayushman');

  -- It agrees with counting the same rows the long way round.
  SELECT count(*) INTO v_direct
    FROM public.lab_results r
    JOIN public.visits v   ON v.id = r.visit_id
    JOIN public.patients p ON p.id = v.patient_id;
  IF (v_all->>'total')::bigint <> v_direct THEN
    RAISE EXCEPTION 'ABORT: total is %, direct count is %', v_all->>'total', v_direct;
  END IF;

  -- The panel would be worthless if it were still zero.
  IF (v_all->>'total')::bigint = 0 THEN
    RAISE EXCEPTION 'ABORT: still counting nothing';
  END IF;

  -- Final + Preliminary are the only two statuses, so they must account for
  -- every row. If a third ever appears this fails loudly rather than quietly
  -- under-reporting.
  IF (v_all->>'final')::bigint + (v_all->>'pending')::bigint <> (v_all->>'total')::bigint THEN
    RAISE EXCEPTION 'ABORT: a result_status other than Final/Preliminary exists; the panel would under-count';
  END IF;

  -- Filtering actually filters, and the parts do not exceed the whole.
  IF (v_hope->>'total')::bigint = 0 OR (v_ayu->>'total')::bigint = 0 THEN
    RAISE EXCEPTION 'ABORT: a hospital filter returned nothing (hope=%, ayushman=%)',
      v_hope->>'total', v_ayu->>'total';
  END IF;
  IF (v_hope->>'total')::bigint + (v_ayu->>'total')::bigint > (v_all->>'total')::bigint THEN
    RAISE EXCEPTION 'ABORT: the hospitals sum to more than the total';
  END IF;

  -- An unknown hospital must be empty, not everything. Getting this backwards
  -- would show Ayushman's numbers to a counter that has none.
  IF (lab_result_stats('no-such-hospital')->>'total')::bigint <> 0 THEN
    RAISE EXCEPTION 'ABORT: an unknown hospital did not return zero';
  END IF;

  RAISE NOTICE 'lab_result_stats: % total (hope %, ayushman %), full scan in % ms',
    v_all->>'total', v_hope->>'total', v_ayu->>'total', v_ms;
END
$verify$;

NOTIFY pgrst, 'reload schema';
