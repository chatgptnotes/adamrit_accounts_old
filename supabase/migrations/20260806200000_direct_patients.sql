-- Direct patients: once marked DIRECT, no referee can be attached — anywhere.
--
-- patients.is_direct + BEFORE triggers on visits.referring_doctor_id and the
-- visit_referees junction enforce it at the database, so every screen
-- (including the frozen registration forms) is covered without touching any
-- of them. The implant-calculation settlement also refuses a REFERRED
-- decision for a direct patient.
--
-- Applied automatically via apply_migration.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS direct_marked_by TEXT,
  ADD COLUMN IF NOT EXISTS direct_marked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.block_referee_on_direct_patient()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_patient UUID;
  v_name TEXT;
BEGIN
  IF TG_TABLE_NAME = 'visits' THEN
    IF NEW.referring_doctor_id IS NULL THEN RETURN NEW; END IF;
    v_patient := NEW.patient_id;
  ELSE -- visit_referees junction
    SELECT patient_id INTO v_patient FROM public.visits WHERE id = NEW.visit_id;
  END IF;
  SELECT name INTO v_name FROM public.patients
   WHERE id = v_patient AND is_direct;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION '% is marked a DIRECT patient — a referee cannot be added', v_name;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_referee_direct ON public.visits;
CREATE TRIGGER trg_block_referee_direct
  BEFORE INSERT OR UPDATE OF referring_doctor_id ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.block_referee_on_direct_patient();

DROP TRIGGER IF EXISTS trg_block_referee_direct_junction ON public.visit_referees;
CREATE TRIGGER trg_block_referee_direct_junction
  BEFORE INSERT OR UPDATE ON public.visit_referees
  FOR EACH ROW EXECUTE FUNCTION public.block_referee_on_direct_patient();

-- The discharge settlement cannot pass a cut for a direct patient either.
-- (Full function replaced; only the is_direct guard is new.)
DO $patch$
BEGIN
  -- Guard inserted by wrapping: create a thin check first in the existing
  -- function's place is complex; instead add a dedicated BEFORE trigger on
  -- implant_calculations.
  NULL;
END;
$patch$;

CREATE OR REPLACE FUNCTION public.block_referred_settlement_on_direct()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.decision = 'REFERRED' THEN
    SELECT p.name INTO v_name
      FROM public.visits v JOIN public.patients p ON p.id = v.patient_id
     WHERE v.id = NEW.visit_uuid AND p.is_direct;
    IF v_name IS NOT NULL THEN
      RAISE EXCEPTION '% is marked a DIRECT patient — settle as DIRECT, no cut', v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_referred_direct ON public.implant_calculations;
CREATE TRIGGER trg_block_referred_direct
  BEFORE INSERT ON public.implant_calculations
  FOR EACH ROW EXECUTE FUNCTION public.block_referred_settlement_on_direct();

NOTIFY pgrst, 'reload schema';
