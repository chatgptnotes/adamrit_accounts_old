-- A third government-portal CSV lane: Dialysis Bill Pending.
--
-- THE INSTRUCTION (18 Aug, Dr M): show how many dialysis patients have
-- completed their required dialysis cycle but whose bills have not yet been
-- prepared. The government portal publishes that list as a CSV every day; it
-- needs importing daily, reading on the day, and keeping so earlier days stay
-- readable.
--
-- NO NEW TABLES. The export carries the same eleven columns as the Under
-- Treatment and Claims exports, and government_portal_report_imports already
-- partitions its history by report_kind. A parallel pair of tables would be a
-- second copy of a parser, a saver and a history reader, and the two would
-- drift the first time the portal changed a column. This lane is
-- report_kind = 'dialysis_bill_pending' on the tables that already exist.
--
-- WHY report_date AND NOT report_date_label. report_date_label is free text
-- copied off the portal ("as on 18/08/2026"), which cannot be compared, sorted
-- or made unique. "One snapshot per day, previous days untouched" needs a real
-- DATE to hang that promise on.
--
-- WHY hospital_type. Hope and Ayushman import their own portal exports. Without
-- a hospital on the import, one hospital's pending list would appear on the
-- other's screen and be worked twice.
--
-- THE UNIQUE INDEX IS SCOPED TO THIS LANE ONLY. The Under Treatment and Claims
-- lanes are uploaded several times a day on purpose, and must keep every
-- upload. Only the dialysis lane is one-snapshot-per-day, so only it is
-- constrained. Old rows in both existing lanes have report_date NULL and are
-- untouched by everything below.

ALTER TABLE public.government_portal_report_imports
  ADD COLUMN IF NOT EXISTS hospital_type TEXT,
  ADD COLUMN IF NOT EXISTS report_date DATE;

COMMENT ON COLUMN public.government_portal_report_imports.report_date IS
  'The day this snapshot represents. report_date_label is the portal''s own free text and is not comparable.';
COMMENT ON COLUMN public.government_portal_report_imports.hospital_type IS
  'Which hospital imported it (hope / ayushman). NULL on imports made before 18 Aug 2026.';

CREATE INDEX IF NOT EXISTS idx_gov_portal_imports_kind_date
  ON public.government_portal_report_imports(report_kind, report_date DESC);

-- One snapshot per hospital per day, for this lane only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_portal_dialysis_pending_one_per_day
  ON public.government_portal_report_imports(COALESCE(hospital_type, ''), report_date)
  WHERE report_kind = 'dialysis_bill_pending' AND report_date IS NOT NULL;

DO $verify$
DECLARE
  v_n     INT;
  v_first UUID;
BEGIN
  -- 1. Both columns exist.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'government_portal_report_imports'
     AND column_name IN ('hospital_type', 'report_date');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected hospital_type and report_date, found % of 2', v_n;
  END IF;

  -- 2. Both indexes exist.
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('idx_gov_portal_imports_kind_date',
                       'idx_gov_portal_dialysis_pending_one_per_day');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected 2 new indexes, found %', v_n;
  END IF;

  -- 3. Rehearsal: the second import of the same hospital-day must be refused,
  --    because that promise is what "the previous day is never overwritten"
  --    rests on. Done on a date no portal export can ever carry.
  INSERT INTO public.government_portal_report_imports
    (file_name, report_kind, hospital_type, report_date)
  VALUES ('SELFTEST-DIALYSIS-PENDING-DO-NOT-USE', 'dialysis_bill_pending', 'selftest', DATE '1900-01-01')
  RETURNING id INTO v_first;

  BEGIN
    INSERT INTO public.government_portal_report_imports
      (file_name, report_kind, hospital_type, report_date)
    VALUES ('SELFTEST-DIALYSIS-PENDING-DO-NOT-USE-2', 'dialysis_bill_pending', 'selftest', DATE '1900-01-01');
    RAISE EXCEPTION 'ABORT: a second snapshot for the same hospital-day was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;

  -- 4. A different hospital on the same day must still be allowed.
  INSERT INTO public.government_portal_report_imports
    (file_name, report_kind, hospital_type, report_date)
  VALUES ('SELFTEST-DIALYSIS-PENDING-DO-NOT-USE-3', 'dialysis_bill_pending', 'selftest2', DATE '1900-01-01');

  -- 5. Clean up, and prove nothing was left behind.
  DELETE FROM public.government_portal_report_imports
   WHERE file_name LIKE 'SELFTEST-DIALYSIS-PENDING-DO-NOT-USE%';

  SELECT count(*) INTO v_n FROM public.government_portal_report_imports
   WHERE file_name LIKE 'SELFTEST-DIALYSIS-PENDING-DO-NOT-USE%'
      OR hospital_type IN ('selftest', 'selftest2')
      OR report_date = DATE '1900-01-01';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ABORT: % rehearsal row(s) survived the cleanup', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
