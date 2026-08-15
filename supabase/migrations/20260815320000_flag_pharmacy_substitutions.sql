-- Substitutions get flagged when the pharmacy actually substitutes.
--
-- is_substituted is false on all 5,081 rows of visit_medications, yet 646 carry
-- a dispensed name different from what was prescribed. The flag was not broken;
-- it was only ever written by ONE of the two dispensing routes.
--
--   * the TABLET (PharmacyDispenseFlow) asks the pharmacist to pick a
--     substitute and records is_substituted = true with their reason. Correct.
--   * the DESKTOP pharmacy does not. Dispensing a prescription_item fires
--     sync_prescription_dispense_to_vm(), which stamps the sold product onto
--     visit_medications -- and never compares it to what was prescribed.
--
-- Every one of the 646 came through the desktop. The pharmacist swapped
-- "Injection monocef" for "CEFTRALYD-1GM INJ VAIL (CEFTRIAXONE-1GM INJ)" and
-- the record said nothing had changed.
--
-- WHAT COUNTS AS A SUBSTITUTION. Not every difference in text is one. The
-- pharmacy's stock names are simply fuller: "Syring 10 ml" is dispensed as
-- "Syring 10 ml- sterile single use hypodermic syring", the same item spelled
-- out. Of the 646 differences, 34 are that and 612 are a genuinely different
-- product. So the comparison strips case and punctuation and then treats one
-- name CONTAINING the other as the same item. Only a name that is neither
-- equal to nor contained in the other is a substitution.
--
-- The rule lives in medication_names_differ() so the trigger and the backfill
-- cannot drift apart, which is how the two dispensing routes ended up
-- disagreeing in the first place.
--
-- A PHARMACIST'S OWN REASON IS NEVER OVERWRITTEN. If is_substituted is already
-- true, this leaves the row alone. The automatic reason says plainly that it
-- was generated, so nobody mistakes it for something a person typed.
--
-- The function below is rebuilt from pg_get_functiondef() against the live
-- database, not from the migration that last defined it (money-path rule 3).
-- The dispense logic and its guards are unchanged; only the substitution
-- columns are added.

CREATE OR REPLACE FUNCTION public.medication_names_differ(
  p_prescribed TEXT,
  p_dispensed  TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- Nothing to compare against is not a substitution.
    WHEN NULLIF(btrim(COALESCE(p_prescribed, '')), '') IS NULL THEN false
    WHEN NULLIF(btrim(COALESCE(p_dispensed,  '')), '') IS NULL THEN false
    ELSE (
      SELECT a <> b
             AND position(a IN b) = 0
             AND position(b IN a) = 0
        FROM (SELECT regexp_replace(lower(btrim(p_prescribed)), '[^a-z0-9]+', '', 'g') AS a,
                     regexp_replace(lower(btrim(p_dispensed)),  '[^a-z0-9]+', '', 'g') AS b) t
    )
  END;
$$;

COMMENT ON FUNCTION public.medication_names_differ IS
  'True when a dispensed product is genuinely a different item from the one '
  'prescribed. Ignores case and punctuation, and treats a fuller name that '
  'contains the prescribed one as the same item.';

CREATE OR REPLACE FUNCTION public.sync_prescription_dispense_to_vm()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF COALESCE(NEW.quantity_dispensed, 0) >= COALESCE(NEW.quantity_prescribed, 0) THEN
    UPDATE public.visit_medications vm
       SET status = 'dispensed',
           dispensed_at = COALESCE(vm.dispensed_at, now()),
           dispensed_medication_name = COALESCE(vm.dispensed_medication_name, NEW.medicine_name),
           -- A pharmacist who already declared a substitution keeps their word
           -- and their reason; otherwise the swap is detected here.
           is_substituted = CASE
             WHEN vm.is_substituted THEN true
             ELSE public.medication_names_differ(
                    vm.custom_medication_name,
                    COALESCE(vm.dispensed_medication_name, NEW.medicine_name))
           END,
           substitute_reason = CASE
             WHEN vm.is_substituted THEN vm.substitute_reason
             WHEN public.medication_names_differ(
                    vm.custom_medication_name,
                    COALESCE(vm.dispensed_medication_name, NEW.medicine_name))
               THEN format('Flagged automatically on dispense: %s supplied against a prescription for %s.',
                           COALESCE(vm.dispensed_medication_name, NEW.medicine_name),
                           vm.custom_medication_name)
             ELSE vm.substitute_reason
           END
     WHERE vm.id = NEW.visit_medication_id
       AND vm.status IS DISTINCT FROM 'dispensed';
  END IF;
  RETURN NEW;
END;
$function$;

-- The trigger itself is unchanged and is left in place; recreating it is
-- unnecessary because CREATE OR REPLACE FUNCTION keeps the existing binding.

-- Backfill the swaps that were never recorded as swaps.
UPDATE public.visit_medications
   SET is_substituted = true,
       substitute_reason = COALESCE(
         substitute_reason,
         format('Flagged automatically on 15 Aug 2026: %s was supplied against a prescription for %s. '
                'Recorded by the system, not by the dispensing pharmacist.',
                dispensed_medication_name, custom_medication_name))
 WHERE is_substituted IS NOT TRUE
   AND public.medication_names_differ(custom_medication_name, dispensed_medication_name);

DO $verify$
DECLARE
  v_flagged INT; v_same INT; v_total INT;
BEGIN
  -- The rule behaves on the real examples that prompted it.
  IF NOT public.medication_names_differ('Injection monocef', 'CEFTRALYD-1GM INJ VAIL((CEFTRIAXONE-1GM INJ)') THEN
    RAISE EXCEPTION 'ABORT: a genuine brand swap was not detected';
  END IF;
  IF public.medication_names_differ('Syring 10 ml', 'Syring 10 ml- sterile single use hypodermic syring') THEN
    RAISE EXCEPTION 'ABORT: a fuller name for the same item was called a substitution';
  END IF;
  IF public.medication_names_differ('Inj rantac50', 'INJ RANTAC 50') THEN
    RAISE EXCEPTION 'ABORT: punctuation and case alone were treated as a substitution';
  END IF;
  IF public.medication_names_differ('Inj Pan 40', NULL)
     OR public.medication_names_differ(NULL, 'PANTAPRAN 40') THEN
    RAISE EXCEPTION 'ABORT: a missing name was treated as a substitution';
  END IF;

  SELECT count(*) INTO v_flagged FROM public.visit_medications WHERE is_substituted;
  IF v_flagged NOT BETWEEN 560 AND 660 THEN
    RAISE EXCEPTION 'ABORT: % rows flagged as substituted, expected about 612', v_flagged;
  END IF;

  -- Every flagged row must be able to say what was swapped for what.
  IF EXISTS (SELECT 1 FROM public.visit_medications
              WHERE is_substituted
                AND NULLIF(btrim(COALESCE(substitute_reason, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'ABORT: a substitution was flagged with no reason recorded';
  END IF;

  -- Nothing that was dispensed exactly as prescribed may be flagged.
  SELECT count(*) INTO v_same FROM public.visit_medications
   WHERE is_substituted
     AND NOT public.medication_names_differ(custom_medication_name, dispensed_medication_name);
  IF v_same > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) flagged though the dispensed item matches the prescription', v_same;
  END IF;

  SELECT count(*) INTO v_total FROM public.visit_medications;
  IF v_total < 5081 THEN
    RAISE EXCEPTION 'ABORT: rows disappeared -- % left of 5,081', v_total;
  END IF;

  RAISE NOTICE 'substitutions: % of % rows flagged', v_flagged, v_total;
END
$verify$;

NOTIFY pgrst, 'reload schema';
