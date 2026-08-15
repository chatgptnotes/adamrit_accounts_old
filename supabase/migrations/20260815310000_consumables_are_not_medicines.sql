-- Needles and syringes stop being filed as medicines.
--
-- visit_medications holds 5,081 rows. 453 of them are not drugs at all --
-- needles, syringes, gloves, IV sets, catheters, a bandage, a urobag -- and
-- they print in the MEDICATIONS table of the discharge summary. 119 of the 172
-- visits with medications are affected, so most discharge papers hand a patient
-- a treatment list with "Needless 18 no" and "EXAMINATION GLOVES MED" in it.
--
-- WHY A STORED FLAG AND NOT A FILTER IN THE SCREEN.
--
-- The obvious fix is to hide anything matching /needle|syringe|glove/ when the
-- summary is drawn. That is resolving by name at read time, which this codebase
-- has been bitten by before (docs/money-path-rules.md, rule 6), and it is worse
-- here than for a ledger: a regex that quietly drops a row from a CLINICAL
-- document can hide a real drug, and nobody would ever see it happen.
--
-- So the decision is made once, at the point of entry, and written down:
--
--   * visit_medications.is_consumable records what each row IS
--   * consumable_name_patterns holds the patterns, as data -- adding one is an
--     INSERT, not a deploy
--   * a BEFORE INSERT trigger classifies new rows as they arrive
--   * the flag is only ever set automatically on INSERT, so if somebody
--     corrects a row afterwards the correction stands
--
-- The screen then asks a straight question -- is this a consumable -- instead of
-- guessing from the name every time it renders.
--
-- WHY THE PATTERNS ARE SAFE HERE. All 58 distinct names they match were read
-- one by one before this was written. Every one is a device: syringes, needles,
-- gloves, IV sets, Foley catheters, roll bandage, urobag. No drug is caught.
-- "Inj 18 no needle" is a needle despite the Inj. The verification block below
-- refuses to commit if that stops being true.
--
-- The rows are NOT deleted. A needle issued to a patient is a real event and
-- the pharmacy charged for it; it simply is not a medicine, and does not belong
-- on a discharge summary.

ALTER TABLE public.visit_medications
  ADD COLUMN IF NOT EXISTS is_consumable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.visit_medications.is_consumable IS
  'True for devices and disposables -- needles, syringes, gloves, IV sets. Set '
  'on insert from consumable_name_patterns; a later correction is never '
  'overwritten. The discharge summary lists only rows where this is false.';

CREATE TABLE IF NOT EXISTS public.consumable_name_patterns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern    TEXT NOT NULL UNIQUE,   -- lower-case SQL LIKE pattern
  note       TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consumable_name_patterns IS
  'Name patterns that mark a visit_medications row as a device rather than a '
  'drug. Data, not code: adding one is an INSERT. Keep them narrow -- a pattern '
  'that catches a real medicine removes it from discharge summaries.';

INSERT INTO public.consumable_name_patterns (pattern, note) VALUES
  ('%needle%',    'incl. "Inj 18 no needle" and INTRODUCER/SPINAL NEEDLE'),
  ('%needless%',  'local spelling of needle'),
  ('%syring%',    'covers syring, syringe, syringes'),
  ('%syrrinj%',   'local spelling of syringe'),
  ('%cannula%',   NULL),
  ('%glove%',     NULL),
  ('%catheter%',  'Foley / Nelaton'),
  ('%iv set%',    NULL),
  ('%cotton%',    NULL),
  ('%bandage%',   NULL),
  ('%gauze%',     NULL),
  ('%urobag%',    NULL),
  ('%drape%',     NULL)
ON CONFLICT (pattern) DO NOTHING;

-- '%mask%' and '%tape%' were considered and left OUT on purpose. Neither
-- matches anything in the data today, and both are short enough to catch a drug
-- name by accident later.

CREATE OR REPLACE FUNCTION public.mark_consumable_medication()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  -- Only ever fills in the default. An explicit true from the caller, or a
  -- human correction later, is left alone.
  IF NEW.is_consumable IS TRUE THEN
    RETURN NEW;
  END IF;

  v_name := lower(
    COALESCE(NEW.dispensed_medication_name, '') || ' ' ||
    COALESCE(NEW.custom_medication_name,    '') || ' ' ||
    COALESCE(NEW.medication_name,           ''));

  SELECT EXISTS (
    SELECT 1 FROM public.consumable_name_patterns p
     WHERE p.is_active AND v_name LIKE p.pattern
  ) INTO NEW.is_consumable;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mark_consumable_medication ON public.visit_medications;
CREATE TRIGGER trg_mark_consumable_medication
  BEFORE INSERT ON public.visit_medications
  FOR EACH ROW EXECUTE FUNCTION public.mark_consumable_medication();

-- Backfill what is already there, by the same rule the trigger will apply.
UPDATE public.visit_medications m
   SET is_consumable = true
 WHERE m.is_consumable = false
   AND EXISTS (
     SELECT 1 FROM public.consumable_name_patterns p
      WHERE p.is_active
        AND lower(COALESCE(m.dispensed_medication_name, '') || ' ' ||
                  COALESCE(m.custom_medication_name,    '') || ' ' ||
                  COALESCE(m.medication_name,           '')) LIKE p.pattern);

DO $verify$
DECLARE
  v_total INT; v_flagged INT; v_drugs INT; v_id UUID; v_visit UUID;
BEGIN
  SELECT count(*) INTO v_total   FROM public.visit_medications;
  SELECT count(*) INTO v_flagged FROM public.visit_medications WHERE is_consumable;

  IF v_total <> 5081 THEN
    RAISE NOTICE 'visit_medications now holds % rows, not the 5,081 measured', v_total;
  END IF;

  -- The measured figure. A wild miss means the patterns changed meaning.
  IF v_flagged NOT BETWEEN 400 AND 520 THEN
    RAISE EXCEPTION 'ABORT: % rows flagged as consumables, expected about 453', v_flagged;
  END IF;

  -- NOTHING THAT IS OBVIOUSLY A DRUG MAY BE HIDDEN. These are real names from
  -- the data; if a pattern ever grows wide enough to swallow one, stop.
  SELECT count(*) INTO v_drugs FROM public.visit_medications
   WHERE is_consumable
     AND lower(COALESCE(dispensed_medication_name, '') || ' ' ||
               COALESCE(custom_medication_name, '')) ~
         '(pantapran|pantaprazole|ceftriaxone|ceftralyd|ceftrapran|monocef|rantac|actrapid|insulin|ondansetron|vomisure|emset)';
  IF v_drugs > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) that name a real drug were flagged as consumables', v_drugs;
  END IF;

  -- Nothing was deleted; the charge history is intact.
  IF v_total < 5081 THEN
    RAISE EXCEPTION 'ABORT: rows disappeared -- % left of 5,081', v_total;
  END IF;

  -- The trigger classifies a new needle, and leaves a new drug alone.
  SELECT visit_id INTO v_visit FROM public.visit_medications LIMIT 1;

  INSERT INTO public.visit_medications (visit_id, custom_medication_name)
  VALUES (v_visit, 'Needless 18 no') RETURNING id INTO v_id;
  IF NOT (SELECT is_consumable FROM public.visit_medications WHERE id = v_id) THEN
    DELETE FROM public.visit_medications WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: the trigger did not catch a needle';
  END IF;
  DELETE FROM public.visit_medications WHERE id = v_id;

  INSERT INTO public.visit_medications (visit_id, custom_medication_name)
  VALUES (v_visit, 'Inj rantac50') RETURNING id INTO v_id;
  IF (SELECT is_consumable FROM public.visit_medications WHERE id = v_id) THEN
    DELETE FROM public.visit_medications WHERE id = v_id;
    RAISE EXCEPTION 'ABORT: the trigger flagged a real drug as a consumable';
  END IF;
  DELETE FROM public.visit_medications WHERE id = v_id;

  -- And the self-test leaves nothing behind.
  IF EXISTS (SELECT 1 FROM public.visit_medications
              WHERE custom_medication_name IN ('Needless 18 no', 'Inj rantac50')
                AND created_at > now() - interval '1 minute') THEN
    RAISE EXCEPTION 'ABORT: self-test rows were left behind';
  END IF;

  RAISE NOTICE 'consumables: % of % rows flagged', v_flagged, v_total;
END
$verify$;

NOTIFY pgrst, 'reload schema';
