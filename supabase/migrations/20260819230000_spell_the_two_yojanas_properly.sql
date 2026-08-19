-- "jan" becomes "Jan", and "Yojna" becomes "Yojana".
--
-- THE INSTRUCTION (19 Aug, Dr M): fix the spelling too, after the duplicate
-- MJPJAY and PMJAY entries were merged in 20260819220000.
--
--   Mahatma Jyotirao Phule jan  Arogya Yojana (MJPJAY)
--                          ^^^
--   Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna  (PM-JAY)
--                                              ^^^^^
--
-- THE CODE HAD TO CHANGE FIRST, AND THIS IS WHY. The same twelve-entry map of
-- full name -> short name was copy-pasted into ten files, every one keyed on
-- these exact strings. In FinalBill.tsx it is not a label: it builds the BILL
-- NUMBER PREFIX and falls back to
--
--     corporateName.toUpperCase().replace(/\s+/g, '-')
--
-- so renaming the corporate without touching that map would have turned every
-- new bill number into MAHATMA-JYOTIRAO-PHULE-JAN-AROGYA-YOJANA-(MJPJAY)-...
-- The ten copies are now one shared lookup that matches on CONTENT
-- ('jyotirao', 'pradhan mantri'), so no spelling can reach a bill number again.
-- That lookup ships in the same commit as this migration and must be deployed;
-- run this after the deploy, not before.
--
-- src/lib/dialysis/scheme.ts was already content-matched, so the MJPJAY-6 /
-- PMJAY-3 session rules were never at risk either way.
--
-- SAME TWELVE COLUMNS AS THE MERGE, and matched case-insensitively on the whole
-- string, so a record already carrying the corrected spelling is left alone and
-- one carrying a stray capital is normalised. Never LIKE: a fragment would also
-- match the other scheme's name.

DO $rename$
DECLARE
  v_old_mj TEXT := 'Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)';
  v_new_mj TEXT := 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)';
  v_old_pm TEXT := 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)';
  v_new_pm TEXT := 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojana (PM-JAY)';
  v_target RECORD;
  v_n      INT;
  v_total  INT := 0;
BEGIN
  -- Renaming onto a name that already exists would make the duplicate this
  -- morning's merge just removed.
  IF EXISTS (SELECT 1 FROM public.corporate WHERE name = v_new_mj)
     AND EXISTS (SELECT 1 FROM public.corporate WHERE name = v_old_mj) THEN
    RAISE EXCEPTION 'ABORT: both spellings of MJPJAY exist — merge them before renaming';
  END IF;
  IF EXISTS (SELECT 1 FROM public.corporate WHERE name = v_new_pm)
     AND EXISTS (SELECT 1 FROM public.corporate WHERE name = v_old_pm) THEN
    RAISE EXCEPTION 'ABORT: both spellings of PM-JAY exist — merge them before renaming';
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('corporate',                      'name'),
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
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_target.tbl AND column_name = v_target.col
    ) THEN
      RAISE EXCEPTION 'ABORT: %.% does not exist — this list is out of date', v_target.tbl, v_target.col;
    END IF;

    EXECUTE format('UPDATE public.%I SET %I = %L WHERE lower(btrim(%I)) = lower(%L)',
                   v_target.tbl, v_target.col, v_new_mj, v_target.col, v_old_mj);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;

    EXECUTE format('UPDATE public.%I SET %I = %L WHERE lower(btrim(%I)) = lower(%L)',
                   v_target.tbl, v_target.col, v_new_pm, v_target.col, v_old_pm);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;

  RAISE NOTICE '% record(s) respelled', v_total;
END
$rename$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_bad INT;
BEGIN
  -- The corrected names must be the ones in the master.
  IF NOT EXISTS (SELECT 1 FROM public.corporate
                  WHERE name = 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)') THEN
    RAISE EXCEPTION 'ABORT: MJPJAY was not respelled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.corporate
                  WHERE name = 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojana (PM-JAY)') THEN
    RAISE EXCEPTION 'ABORT: PM-JAY was not respelled';
  END IF;

  -- And still exactly one of each, not two.
  SELECT count(*) INTO v_bad FROM public.corporate WHERE name ILIKE '%(MJPJAY)';
  IF v_bad <> 1 THEN RAISE EXCEPTION 'ABORT: % MJPJAY row(s), expected 1', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM public.corporate WHERE name ILIKE '%(PM-JAY)';
  IF v_bad <> 1 THEN RAISE EXCEPTION 'ABORT: % PM-JAY row(s), expected 1', v_bad; END IF;

  -- No record may be left on the old spelling.
  SELECT count(*) INTO v_bad FROM (
    SELECT 1 FROM public.patients          WHERE corporate      LIKE '%Phule jan%' OR corporate      LIKE '%Yojna (PM-JAY)%'
    UNION ALL SELECT 1 FROM public.visits           WHERE corporate      LIKE '%Phule jan%' OR corporate      LIKE '%Yojna (PM-JAY)%'
    UNION ALL SELECT 1 FROM public.bill_preparation WHERE corporate      LIKE '%Phule jan%' OR corporate      LIKE '%Yojna (PM-JAY)%'
    UNION ALL SELECT 1 FROM public.yojna_bills      WHERE corporate_name LIKE '%Phule jan%' OR corporate_name LIKE '%Yojna (PM-JAY)%'
  ) o;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % record(s) still carry the old spelling', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT c.name AS scheme,
       (SELECT count(*) FROM public.patients        p WHERE p.corporate      = c.name) AS patients,
       (SELECT count(*) FROM public.yojna_bills     y WHERE y.corporate_name = c.name) AS yojna_bills,
       (SELECT count(*) FROM public.bill_preparation b WHERE b.corporate     = c.name) AS prepared_bills
  FROM public.corporate c
 WHERE c.name ILIKE '%(MJPJAY)' OR c.name ILIKE '%(PM-JAY)'
 ORDER BY c.name;
