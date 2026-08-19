-- One scheme, one entry in the corporate list.
--
-- THE INSTRUCTION (19 Aug, Dr M): MJPJAY stands for Mahatma Jyotirao Phule Jan
-- Arogya Yojana and PMJAY for Pradhan Mantri Jan Arogya Yojana — there is no need
-- for two items in the dropdown for either.
--
-- WHAT IS ACTUALLY THERE. Five rows, not four: PMJAY has THREE.
--
--   KEEP  Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)   19-Sep-25, company set
--   MERGE MJPJAY                                              26-Jul-26, no company
--   KEEP  Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)  19-Sep-25, company set
--   MERGE PMJAY                                               26-Jul-26, no company
--   MERGE AB-PMJAY                                            26-Jul-26, no company
--
-- The three short ones were all created in one go on 26-Jul-26 and none carries a
-- company_id, so they post to no company's books. The two kept are the originals
-- from September, they carry the company, and they hold the patients.
--
-- THE DUPLICATES ARE IN USE, which is why this is a merge and not a delete. The
-- corporate is stored as TEXT on the records, not as an id:
--
--   patients      MJPJAY 1,  PMJAY 2,  AB-PMJAY 3
--   yojna_bills   MJPJAY 11, PMJAY 6,  AB-PMJAY 2
--
-- Deleting the rows alone would leave 25 records naming a scheme that no longer
-- exists in the master — the panel would still be printed on the bill and would
-- match nothing in any report. Every text reference is repointed FIRST, then the
-- rows go.
--
-- NOTHING POINTS AT THEM BY ID: corporate_bulk_payments, corporate_areas,
-- corporate_master_contacts and corporate_master_meetings all hold zero rows for
-- the three, so there is no ledger or contact history to carry across.
--
-- THE KEPT NAMES ARE NOT RETYPED. "jan" is lower case in the MJPJAY name and the
-- PMJAY one spells it "Yojna"; both are wrong as English and both are what 228
-- patients, 159 bills and 134 prepared bills already say. Correcting the spelling
-- means rewriting every one of those references, which is a separate decision with
-- a separate risk. Recommended to Dr M, not taken here.
--
-- MATCHED ON EXACT EQUALITY, never LIKE. '%mjpjay%' would also match the name
-- being kept, which ends in "(MJPJAY)", and the merge would eat its own target.

DO $merge$
DECLARE
  v_mjpjay   TEXT := 'Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)';
  v_pmjay    TEXT := 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)';
  -- table, column, the short name to replace, what to replace it with
  v_target   RECORD;
  v_n        INT;
  v_total    INT := 0;
BEGIN
  -- The two survivors must exist before anything is repointed at them.
  IF NOT EXISTS (SELECT 1 FROM public.corporate WHERE name = v_mjpjay) THEN
    RAISE EXCEPTION 'ABORT: the MJPJAY row to keep is not there under that exact name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.corporate WHERE name = v_pmjay) THEN
    RAISE EXCEPTION 'ABORT: the PMJAY row to keep is not there under that exact name';
  END IF;

  CREATE TEMP TABLE merge_report(place TEXT, from_name TEXT, to_name TEXT, rows_moved INT)
    ON COMMIT DROP;

  -- Every column that stores a corporate NAME as text. Listed rather than
  -- discovered, so a column added later is a deliberate decision to include and
  -- not a surprise sweep across the database. corporate_type on
  -- ipd_discharge_summary and surgical_billing is deliberately absent: it holds
  -- 'private'/'panel', not a scheme name.
  FOR v_target IN
    SELECT * FROM (VALUES
      ('patients',                       'corporate'),
      ('visits',                         'corporate'),
      ('bill_preparation',               'corporate'),
      ('panel_payment_receipts',         'corporate'),
      ('panel_document_waivers',         'corporate'),
      ('ecosystem_patients',             'corporate'),
      ('yojna_bills',                    'corporate_name'),
      ('tpa_claims',                     'corporate_name'),
      ('lab_breakup',                    'corporate_name'),
      ('corporate_bulk_payments',        'corporate_name'),
      ('email_logs',                     'corporate_name'),
      ('corporate_collection_management','corporate_company')
    ) AS t(tbl, col)
  LOOP
    -- A table named here that has since been dropped must be noticed, not
    -- skipped in silence.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_target.tbl AND column_name = v_target.col
    ) THEN
      RAISE EXCEPTION 'ABORT: %.% does not exist — this list is out of date', v_target.tbl, v_target.col;
    END IF;

    -- MJPJAY
    EXECUTE format(
      'UPDATE public.%I SET %I = %L WHERE lower(btrim(%I)) = %L',
      v_target.tbl, v_target.col, v_mjpjay, v_target.col, 'mjpjay');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO merge_report VALUES (v_target.tbl || '.' || v_target.col, 'MJPJAY', v_mjpjay, v_n);
      v_total := v_total + v_n;
    END IF;

    -- PMJAY and AB-PMJAY both become the one Ayushman Bharat row.
    EXECUTE format(
      'UPDATE public.%I SET %I = %L WHERE lower(btrim(%I)) IN (%L, %L)',
      v_target.tbl, v_target.col, v_pmjay, v_target.col, 'pmjay', 'ab-pmjay');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO merge_report VALUES (v_target.tbl || '.' || v_target.col, 'PMJAY / AB-PMJAY', v_pmjay, v_n);
      v_total := v_total + v_n;
    END IF;
  END LOOP;

  RAISE NOTICE '% reference(s) repointed onto the two surviving schemes', v_total;

  -- Only now that nothing names them.
  DELETE FROM public.corporate
   WHERE lower(btrim(name)) IN ('mjpjay', 'pmjay', 'ab-pmjay');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '% duplicate corporate row(s) removed', v_n;

  INSERT INTO merge_report VALUES ('corporate (the dropdown)', 'the three short names', 'deleted', v_n);
END
$merge$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_left INT; v_orphans INT;
BEGIN
  SELECT count(*) INTO v_left FROM public.corporate
   WHERE lower(btrim(name)) IN ('mjpjay', 'pmjay', 'ab-pmjay');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % short-name row(s) survive in the dropdown', v_left;
  END IF;

  -- The two that matter must still be there, with their patients.
  IF NOT EXISTS (SELECT 1 FROM public.corporate WHERE name ILIKE '%(MJPJAY)') THEN
    RAISE EXCEPTION 'ABORT: the MJPJAY scheme has gone from the master';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.corporate WHERE name ILIKE '%(PM-JAY)') THEN
    RAISE EXCEPTION 'ABORT: the PMJAY scheme has gone from the master';
  END IF;

  -- No record may name a scheme that is no longer in the master. This is the
  -- check that makes it a merge rather than a deletion.
  SELECT count(*) INTO v_orphans FROM (
    SELECT corporate      AS c FROM public.patients               WHERE lower(btrim(corporate))      IN ('mjpjay','pmjay','ab-pmjay')
    UNION ALL SELECT corporate      FROM public.visits            WHERE lower(btrim(corporate))      IN ('mjpjay','pmjay','ab-pmjay')
    UNION ALL SELECT corporate      FROM public.bill_preparation  WHERE lower(btrim(corporate))      IN ('mjpjay','pmjay','ab-pmjay')
    UNION ALL SELECT corporate_name FROM public.yojna_bills       WHERE lower(btrim(corporate_name)) IN ('mjpjay','pmjay','ab-pmjay')
  ) o;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'ABORT: % record(s) still name a deleted scheme', v_orphans;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it
-- The two schemes and everything now filed under them.

SELECT c.name AS scheme,
       (c.company_id IS NOT NULL) AS posts_to_a_company,
       (SELECT count(*) FROM public.patients    p WHERE p.corporate      = c.name) AS patients,
       (SELECT count(*) FROM public.yojna_bills y WHERE y.corporate_name = c.name) AS yojna_bills,
       (SELECT count(*) FROM public.bill_preparation b WHERE b.corporate = c.name) AS prepared_bills
  FROM public.corporate c
 WHERE c.name ILIKE '%(MJPJAY)' OR c.name ILIKE '%(PM-JAY)'
 ORDER BY c.name;
