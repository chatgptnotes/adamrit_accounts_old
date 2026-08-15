-- Real numbers for the last two invented panels on the Lab dashboard.
--
-- "Top Tests Today" and "Department Status" were both hardcoded arrays. The
-- activity feed beside them was deleted outright; these two can be answered
-- from real data, but only one of them completely, and the difference is the
-- point of this migration.
--
-- ---------------------------------------------------------------- TOP TESTS
--
-- Fully real. visit_labs records every ordered test with its lab_id, and 107
-- were ordered today. 104 of those carry a completed_date, so the turnaround
-- time is measured rather than invented -- ordered_date to completed_date, in
-- hours, averaged per test.
--
-- The day is the IST day. ordered_date is a timestamptz and the server runs in
-- UTC, so ordered_date::date silently rolls over at 5:30am local and would drop
-- the early morning's work from "today".
--
-- Where nothing has completed yet, tat_hours comes back NULL and the screen
-- shows a dash. A test ordered ten minutes ago has no turnaround time, and
-- printing 0.0 hrs would be the old problem again in a smaller font.
--
-- -------------------------------------------------------- DEPARTMENT STATUS
--
-- Partly real, and the missing part is NOT filled in.
--
-- The mock showed Pending and Completed counts per department. Those cannot be
-- produced: THERE IS NO DEPARTMENT ON A TEST. `lab` carries a free-text
-- `category` with 25 values -- BIOCHEMISTRY, SEROLOGY, HEMATOLOGY, VITAMIN
-- ASSAY, HBA1C, HORMONES -- and nothing joins them to lab_departments.
--
-- Mapping them by name was the obvious move and is the wrong one. Is SEROLOGY
-- (252 tests this week) Immunology or Microbiology? Is HORMONES Chemistry or
-- Immunoassay? Those are clinical decisions, and a guess produces a number that
-- looks authoritative and is wrong -- which is exactly what the fabricated
-- panels did. Two of the five departments have no plausible category at all:
-- nothing was sent to Microbiology or Molecular Diagnostics this week.
--
-- So this returns what is actually recorded: the department, its code, and the state of
-- its equipment, which IS linked -- lab_equipment.department_id is populated for
-- all five machines. Pending and Completed leave the card until somebody puts a
-- department on the test master, which is a data-entry decision, not a query.

CREATE OR REPLACE FUNCTION public.lab_top_tests_today(
  p_hospital_type TEXT DEFAULT NULL,
  p_limit         INT  DEFAULT 5
)
RETURNS TABLE (test_name TEXT, ordered_count BIGINT, tat_hours NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(l.name, '(unnamed test)')::TEXT,
    count(*),
    round(
      avg(EXTRACT(EPOCH FROM (vl.completed_date - vl.ordered_date)) / 3600.0)
        FILTER (WHERE vl.completed_date IS NOT NULL AND vl.ordered_date IS NOT NULL)
    ::numeric, 1)
    FROM public.visit_labs vl
    JOIN public.lab      l ON l.id = vl.lab_id
    JOIN public.visits   v ON v.id = vl.visit_id
    JOIN public.patients p ON p.id = v.patient_id
   WHERE (vl.ordered_date AT TIME ZONE 'Asia/Kolkata')::date
         = (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND (p_hospital_type IS NULL
          OR lower(btrim(COALESCE(p.hospital_name, ''))) = lower(btrim(p_hospital_type)))
   GROUP BY l.name
   ORDER BY count(*) DESC, l.name
   LIMIT GREATEST(COALESCE(p_limit, 5), 1);
$$;

CREATE OR REPLACE FUNCTION public.lab_department_status()
RETURNS TABLE (
  department_name  TEXT,
  department_code  TEXT,
  equipment_total  BIGINT,
  equipment_active BIGINT,
  equipment_state  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.department_name::TEXT,
    COALESCE(d.department_code, '')::TEXT,
    count(e.id),
    count(e.id) FILTER (WHERE lower(btrim(COALESCE(e.equipment_status, ''))) = 'active'),
    CASE
      WHEN count(e.id) = 0 THEN 'No equipment'
      WHEN count(e.id) = count(e.id) FILTER (
             WHERE lower(btrim(COALESCE(e.equipment_status, ''))) = 'active') THEN 'Active'
      -- Anything not active is named rather than lumped into "issue", so the
      -- screen says Maintenance when it means maintenance.
      ELSE COALESCE((SELECT string_agg(DISTINCT e2.equipment_status, ', ')
                       FROM public.lab_equipment e2
                      WHERE e2.department_id = d.id
                        AND lower(btrim(COALESCE(e2.equipment_status, ''))) <> 'active'),
                    'Unknown')
    END::TEXT
    FROM public.lab_departments d
    LEFT JOIN public.lab_equipment e ON e.department_id = d.id
   WHERE COALESCE(d.is_active, true)
   GROUP BY d.id, d.department_name, d.department_code
   ORDER BY d.department_name;
$$;

REVOKE ALL ON FUNCTION public.lab_top_tests_today   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lab_department_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lab_top_tests_today   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lab_department_status TO anon, authenticated;

COMMENT ON FUNCTION public.lab_top_tests_today IS
  'Most-ordered tests for the current IST day, with measured turnaround from '
  'ordered_date to completed_date. NULL turnaround means nothing has completed.';
COMMENT ON FUNCTION public.lab_department_status IS
  'Lab departments and the real state of their equipment. Deliberately carries '
  'no pending/completed counts: no column links a test to a department, and '
  'mapping lab.category to a department by name would be a clinical guess.';

DO $verify$
DECLARE
  v_rows INT; v_today INT; v_direct BIGINT; v_top RECORD; v_depts INT; v_equip BIGINT;
BEGIN
  -- ---- top tests -------------------------------------------------------
  SELECT count(*) INTO v_today FROM public.visit_labs
   WHERE (ordered_date AT TIME ZONE 'Asia/Kolkata')::date
         = (now() AT TIME ZONE 'Asia/Kolkata')::date;

  SELECT count(*) INTO v_rows FROM lab_top_tests_today(NULL, 5);

  IF v_today > 0 AND v_rows = 0 THEN
    RAISE EXCEPTION 'ABORT: % tests ordered today but the panel returns nothing', v_today;
  END IF;

  IF v_rows > 0 THEN
    SELECT * INTO v_top FROM lab_top_tests_today(NULL, 5) LIMIT 1;

    -- The headline count must survive being counted a different way.
    SELECT count(*) INTO v_direct
      FROM public.visit_labs vl JOIN public.lab l ON l.id = vl.lab_id
      JOIN public.visits v ON v.id = vl.visit_id
      JOIN public.patients p ON p.id = v.patient_id
     WHERE l.name = v_top.test_name
       AND (vl.ordered_date AT TIME ZONE 'Asia/Kolkata')::date
           = (now() AT TIME ZONE 'Asia/Kolkata')::date;
    IF v_direct <> v_top.ordered_count THEN
      RAISE EXCEPTION 'ABORT: % counted as % but directly as %',
        v_top.test_name, v_top.ordered_count, v_direct;
    END IF;

    -- A negative turnaround means completed before ordered; better to know.
    IF v_top.tat_hours IS NOT NULL AND v_top.tat_hours < 0 THEN
      RAISE EXCEPTION 'ABORT: % has a negative turnaround (%)', v_top.test_name, v_top.tat_hours;
    END IF;

    -- Ordering is what makes it "top".
    IF EXISTS (SELECT 1 FROM lab_top_tests_today(NULL, 5) t
                WHERE t.ordered_count > v_top.ordered_count) THEN
      RAISE EXCEPTION 'ABORT: the list is not ordered by count';
    END IF;
  END IF;

  -- An unknown hospital must be empty, never everything.
  IF (SELECT count(*) FROM lab_top_tests_today('no-such-hospital', 5)) <> 0 THEN
    RAISE EXCEPTION 'ABORT: an unknown hospital returned tests';
  END IF;

  -- ---- departments -----------------------------------------------------
  SELECT count(*) INTO v_depts FROM lab_department_status();
  IF v_depts = 0 THEN
    RAISE EXCEPTION 'ABORT: no departments returned';
  END IF;
  IF v_depts <> (SELECT count(*) FROM public.lab_departments WHERE COALESCE(is_active, true)) THEN
    RAISE EXCEPTION 'ABORT: department count does not match the table';
  END IF;

  -- Every machine is accounted for exactly once across the departments.
  SELECT COALESCE(sum(equipment_total), 0) INTO v_equip FROM lab_department_status();
  IF v_equip <> (SELECT count(*) FROM public.lab_equipment e
                  JOIN public.lab_departments d ON d.id = e.department_id
                 WHERE COALESCE(d.is_active, true)) THEN
    RAISE EXCEPTION 'ABORT: equipment is double counted or missing (%)', v_equip;
  END IF;

  IF EXISTS (SELECT 1 FROM lab_department_status() WHERE equipment_active > equipment_total) THEN
    RAISE EXCEPTION 'ABORT: a department has more working machines than machines';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
