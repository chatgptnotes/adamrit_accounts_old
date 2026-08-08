-- visits.dialysis_partner — the column the registration form has been writing
-- to all along.
--
-- Registering any visit fails with "Could not find the 'dialysis_partner'
-- column of 'visits' in the schema cache": the form sends it on every insert
-- and update, the generated types declare it, and the NephroPlus dialysis
-- reports read it — but no migration ever created it, so the whole visit
-- registration is blocked, dialysis or not.
--
-- It holds which dialysis partner runs the session (NephroPlus is what the
-- form defaults to), and stays null for every other visit type, which is
-- exactly what the form sends.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS dialysis_partner TEXT;

COMMENT ON COLUMN public.visits.dialysis_partner IS
  'Dialysis partner running the session (e.g. NephroPlus). Null for every '
  'visit type other than dialysis.';

CREATE INDEX IF NOT EXISTS visits_dialysis_partner_idx
  ON public.visits (dialysis_partner) WHERE dialysis_partner IS NOT NULL;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'visits'
       AND column_name = 'dialysis_partner'
  ) THEN
    RAISE EXCEPTION 'ABORT: dialysis_partner was not added to visits';
  END IF;
  RAISE NOTICE 'OK — visits can be registered again';
END $$;
