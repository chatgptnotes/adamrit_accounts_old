-- Keywords for the 16 fee rows that had none.
--
-- The search box on Surgery Fees Payable looks at package name, Yojana surgery
-- name and keywords. Sixteen rows carried only their scheme tags, so they were
-- findable only by someone who already knew the exact spelling in the master --
-- "Piles" found nothing, "Gall bladder" found nothing.
--
-- SAFE BY DESIGN. Keywords are search-only and never price anything; the
-- comment in src/lib/approval-queue-service.ts is explicit that a keyword must
-- not determine a payable amount, and the fee lookup matches on procedure_name
-- and yojana_surgery_name only. So a wrong keyword costs a bad search result,
-- never a wrong payment.
--
-- Scheme tags (PMJAY / Surgical) are left exactly as they are. Two of these
-- rows carry none, and adding one would be a claim about how the case is
-- billed, which is not a naming question.
--
-- Idempotent: a keyword already present is not added twice, so re-running or
-- running after somebody has edited a row by hand changes nothing unexpected.

DO $apply$
DECLARE
  r        RECORD;
  v_new    TEXT[];
  v_added  INT := 0;
  v_rows   INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Appendicectomy', ARRAY['Appendectomy','Appendix Removal','Acute Appendicitis','Laparoscopic Appendicectomy','Open Appendicectomy']),
      ('AUXILLIARY DISSECTION FOR LUMPECTOMY', ARRAY['Axillary Dissection','Lumpectomy','Axillary Lymph Node Dissection','Breast Conserving Surgery','Sentinel Node Biopsy']),
      ('EVL LIGATION', ARRAY['Endoscopic Variceal Ligation','Oesophageal Varices','Variceal Banding','Upper GI Endoscopy','Portal Hypertension']),
      ('EXPLORATORY LAPARATOMY', ARRAY['Exploratory Laparotomy','Laparotomy','Abdominal Exploration','Emergency Laparotomy','Acute Abdomen']),
      ('Haemarrhoidectomy', ARRAY['Haemorrhoidectomy','Piles Surgery','Hemorrhoids','Anal Surgery','Stapled Haemorrhoidopexy']),
      ('LAP. CHOLECYSTECTOMY', ARRAY['Laparoscopic Cholecystectomy','Gall Bladder Removal','Cholelithiasis','Gallstones','Keyhole Gall Bladder Surgery']),
      ('Mastoidectomy', ARRAY['Mastoid Surgery','Cortical Mastoidectomy','Modified Radical Mastoidectomy','Chronic Otitis Media','Middle Ear Surgery']),
      ('MRM (MODIFIED RADICAL MASTECTOMY)', ARRAY['Modified Radical Mastectomy','Mastectomy','Breast Cancer Surgery','Axillary Clearance','Breast Removal']),
      ('Myringotomy', ARRAY['Grommet Insertion','Ear Drum Incision','Tympanostomy','Middle Ear Effusion','Ventilation Tube']),
      ('ORIF WITH SMALL BONE', ARRAY['Open Reduction Internal Fixation','ORIF','Small Bone Fracture','Fracture Fixation','Plating and Screws']),
      ('OSSICULOPLASTY', ARRAY['Ossicular Chain Reconstruction','Middle Ear Reconstruction','Hearing Restoration','Ossicular Prosthesis','Conductive Hearing Loss']),
      ('Otoplasty', ARRAY['Ear Reshaping','Pinnaplasty','Prominent Ear Correction','Cosmetic Ear Surgery','Auricular Reconstruction']),
      ('SALPINGOOPHERECTOMY', ARRAY['Salpingo-Oophorectomy','Ovary Removal','Fallopian Tube Removal','Adnexectomy','Ovarian Cyst Surgery']),
      ('Splenectomy - For Trauma', ARRAY['Splenectomy','Spleen Removal','Splenic Injury','Traumatic Splenic Rupture','Emergency Laparotomy']),
      ('Stapedectomy', ARRAY['Stapes Surgery','Otosclerosis','Stapedotomy','Hearing Restoration','Middle Ear Surgery']),
      ('TYMPANOPLASTY', ARRAY['Ear Drum Repair','Myringoplasty','Chronic Otitis Media','Middle Ear Surgery','Tympanic Membrane Graft'])
    ) AS t(procedure_name, keywords)
  LOOP
    -- Existing tags first, then any keyword not already there in some casing.
    SELECT COALESCE(f.tags, ARRAY[]::TEXT[]) || ARRAY(
             SELECT k FROM unnest(r.keywords) AS k
              WHERE NOT EXISTS (
                SELECT 1 FROM unnest(COALESCE(f.tags, ARRAY[]::TEXT[])) AS existing
                 WHERE lower(btrim(existing)) = lower(btrim(k))
              )
           )
      INTO v_new
      FROM public.surgery_fee_master f
     WHERE f.is_active AND btrim(f.procedure_name) = r.procedure_name;

    IF v_new IS NULL THEN
      -- The master is edited by hand; a renamed row is a reason to stop and
      -- look, not to guess which row was meant.
      RAISE EXCEPTION 'ABORT: no active fee row named "%"', r.procedure_name;
    END IF;

    UPDATE public.surgery_fee_master
       SET tags = v_new, updated_at = now()
     WHERE is_active AND btrim(procedure_name) = r.procedure_name
       AND tags IS DISTINCT FROM v_new;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_added := v_added + v_rows;
  END LOOP;

  RAISE NOTICE 'Keywords added to % row(s)', v_added;
END
$apply$;

DO $verify$
DECLARE
  v_bare INT;
BEGIN
  -- No active row may be left findable only by its exact stored spelling.
  SELECT count(*) INTO v_bare
    FROM public.surgery_fee_master f
   WHERE f.is_active
     AND NOT EXISTS (
       SELECT 1 FROM unnest(COALESCE(f.tags, ARRAY[]::TEXT[])) AS t
        WHERE lower(btrim(t)) NOT IN ('pmjay','mjpjay','surgical','medical','cghs','esic')
     );
  IF v_bare > 0 THEN
    RAISE EXCEPTION 'ABORT: % active row(s) still have no clinical keyword', v_bare;
  END IF;
  RAISE NOTICE 'Every active fee row now carries at least one clinical keyword.';
END
$verify$;
