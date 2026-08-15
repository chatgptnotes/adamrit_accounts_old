-- The pharmacist's substitution reason reaches the patient's record.
--
-- CORRECTION TO WHAT WAS REPORTED THIS MORNING. I said the desktop pharmacy
-- never asks why a medicine was changed and that the reason would have to be
-- added. That was wrong. PrescriptionQueue has had a "Reason for substitution"
-- field all along, and 741 substitutions are recorded on prescription_items,
-- every one of them with a reason and 734 linked to a visit_medications row.
--
-- The reason was being captured. It just never travelled.
-- sync_prescription_dispense_to_vm() carries the dispensed NAME across to
-- visit_medications and leaves is_substituted and substitute_reason behind, so
-- the ward record -- and the discharge summary that reads it -- never learned
-- that a pharmacist had made a deliberate, explained swap.
--
-- That also means 20260815320000 was solving the wrong half of the problem. It
-- inferred substitutions by comparing names and wrote sentences like "Flagged
-- automatically ... Recorded by the system, not by the dispensing pharmacist."
-- Where a real reason exists, it should say what the pharmacist said. This
-- migration replaces the inferred text with the recorded reason wherever
-- prescription_items has one, and leaves the inference in place only for swaps
-- nobody declared.
--
-- Precedence, highest first:
--   1. a reason a human typed on prescription_items
--   2. the inferred one from name comparison (still better than silence)
--   3. nothing -- the row is not a substitution
--
-- The desktop screen now REQUIRES the reason. All 741 existing ones read
-- "Stock substitution by pharmacist", the silent default that fired when the
-- field was left blank -- which is another way of saying nobody ever filled it
-- in. Those are preserved as-is; they are what was recorded.

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
           -- The pharmacist's own declaration comes first; a swap they did not
           -- declare is still caught by comparing the names.
           is_substituted = CASE
             WHEN vm.is_substituted THEN true
             WHEN COALESCE(NEW.is_substituted, false) THEN true
             ELSE public.medication_names_differ(
                    vm.custom_medication_name,
                    COALESCE(vm.dispensed_medication_name, NEW.medicine_name))
           END,
           substitute_reason = CASE
             -- Never overwrite a reason already on the ward record.
             WHEN NULLIF(btrim(COALESCE(vm.substitute_reason, '')), '') IS NOT NULL
               AND vm.is_substituted
               THEN vm.substitute_reason
             -- What the pharmacist typed at the counter.
             WHEN NULLIF(btrim(COALESCE(NEW.substitute_reason, '')), '') IS NOT NULL
               THEN NEW.substitute_reason
             -- Nobody said anything, but the product plainly changed.
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

-- Bring across every reason a pharmacist actually recorded, replacing the
-- inferred sentence written by 20260815320000 where a real one exists.
UPDATE public.visit_medications vm
   SET is_substituted   = true,
       substitute_reason = pi.substitute_reason
  FROM public.prescription_items pi
 WHERE pi.visit_medication_id = vm.id
   AND pi.is_substituted
   AND NULLIF(btrim(COALESCE(pi.substitute_reason, '')), '') IS NOT NULL
   AND vm.substitute_reason IS DISTINCT FROM pi.substitute_reason;

DO $verify$
DECLARE
  v_pi INT; v_carried INT; v_flagged INT; v_inferred INT; v_orphan INT;
BEGIN
  SELECT count(*) INTO v_pi FROM public.prescription_items
   WHERE is_substituted AND visit_medication_id IS NOT NULL
     AND NULLIF(btrim(COALESCE(substitute_reason, '')), '') IS NOT NULL;

  -- Every declared substitution that points at a ward row must now be on it,
  -- carrying the pharmacist's words and not a generated sentence.
  SELECT count(*) INTO v_carried
    FROM public.prescription_items pi
    JOIN public.visit_medications vm ON vm.id = pi.visit_medication_id
   WHERE pi.is_substituted
     AND NULLIF(btrim(COALESCE(pi.substitute_reason, '')), '') IS NOT NULL
     AND vm.is_substituted
     AND vm.substitute_reason = pi.substitute_reason;

  IF v_carried <> v_pi THEN
    RAISE EXCEPTION 'ABORT: % declared substitutions but only % reached the ward record', v_pi, v_carried;
  END IF;

  -- No row may claim a substitution without saying what happened.
  IF EXISTS (SELECT 1 FROM public.visit_medications
              WHERE is_substituted
                AND NULLIF(btrim(COALESCE(substitute_reason, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'ABORT: a substitution is flagged with no reason';
  END IF;

  -- A pharmacist's words must never be described as machine-generated.
  SELECT count(*) INTO v_orphan
    FROM public.prescription_items pi
    JOIN public.visit_medications vm ON vm.id = pi.visit_medication_id
   WHERE pi.is_substituted
     AND NULLIF(btrim(COALESCE(pi.substitute_reason, '')), '') IS NOT NULL
     AND vm.substitute_reason LIKE 'Flagged automatically%';
  IF v_orphan > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) still carry an inferred reason though a real one exists', v_orphan;
  END IF;

  SELECT count(*) INTO v_flagged  FROM public.visit_medications WHERE is_substituted;
  SELECT count(*) INTO v_inferred FROM public.visit_medications
   WHERE is_substituted AND substitute_reason LIKE 'Flagged automatically%';

  IF v_flagged = 0 THEN
    RAISE EXCEPTION 'ABORT: nothing is flagged as substituted at all';
  END IF;

  RAISE NOTICE 'substitutions on the ward record: % total, % from the pharmacist, % still inferred',
    v_flagged, v_flagged - v_inferred, v_inferred;
END
$verify$;

NOTIFY pgrst, 'reload schema';
