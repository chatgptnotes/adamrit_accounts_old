-- Remember that a charge was deliberately removed from a bill.
--
-- Reported: deleting MLC Processing Charges and Emergency Charges on the Final
-- Bill does not stick -- they are back after a reload.
--
-- The delete works. visit_clinical_services holds five rows for IH26H15002 and
-- neither charge is among them. What happens next is that opening the bill
-- auto-adds them again:
--
--   // Auto-add one-time charges (Emergency, Consultation, MLC Processing)
--   ... // Only insert if not already present
--
-- "Not already present" is precisely what deleting achieves, so the page undoes
-- the deletion every time it loads. Only these three behave this way, which is
-- why other services stay deleted and these do not.
--
-- Auto-adding is wanted -- a new bill should start with the charges that nearly
-- always apply. What was missing is any memory of the exception. So a deletion
-- now records itself here, and the auto-add skips anything on this list.
--
-- Deliberately not a flag on visit_clinical_services: the row is gone, so there
-- is nothing left to flag. The absence has to be recorded somewhere of its own.
--
-- A manual re-add is unaffected: this only suppresses the AUTOMATIC insert, so
-- somebody who removes a charge by mistake can simply add it back.

CREATE TABLE IF NOT EXISTS public.visit_clinical_service_exclusions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id            UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  clinical_service_id UUID NOT NULL,
  excluded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  excluded_by         TEXT,
  CONSTRAINT visit_clinical_service_exclusions_unique UNIQUE (visit_id, clinical_service_id)
);

COMMENT ON TABLE public.visit_clinical_service_exclusions IS
  'Charges a person deliberately removed from a bill. The Final Bill auto-adds '
  'Emergency, Consultation and MLC Processing when they are absent; this is how '
  'it knows an absence was intended rather than accidental.';

CREATE INDEX IF NOT EXISTS visit_clinical_service_exclusions_visit_idx
  ON public.visit_clinical_service_exclusions (visit_id);

ALTER TABLE public.visit_clinical_service_exclusions ENABLE ROW LEVEL SECURITY;

-- Same reach as visit_clinical_services itself. A stricter policy here would
-- mean the exclusion silently fails to save and the charge comes back -- the
-- very bug being fixed.
DROP POLICY IF EXISTS "app access pending identity" ON public.visit_clinical_service_exclusions;
CREATE POLICY "app access pending identity"
  ON public.visit_clinical_service_exclusions
  FOR ALL TO public USING (true) WITH CHECK (true);

DO $verify$
DECLARE v_visit UUID; v_svc UUID; v_n INT;
BEGIN
  SELECT id INTO v_visit FROM public.visits LIMIT 1;
  SELECT id INTO v_svc FROM public.clinical_services LIMIT 1;
  IF v_visit IS NULL OR v_svc IS NULL THEN
    RAISE EXCEPTION 'ABORT: nothing to self-test with';
  END IF;

  INSERT INTO public.visit_clinical_service_exclusions (visit_id, clinical_service_id, excluded_by)
  VALUES (v_visit, v_svc, 'selftest');

  -- Recording the same exclusion twice must not fail: a charge can be deleted,
  -- added back and deleted again, and the second delete must still be honoured.
  INSERT INTO public.visit_clinical_service_exclusions (visit_id, clinical_service_id, excluded_by)
  VALUES (v_visit, v_svc, 'selftest')
  ON CONFLICT (visit_id, clinical_service_id) DO NOTHING;

  SELECT count(*) INTO v_n FROM public.visit_clinical_service_exclusions
   WHERE visit_id = v_visit AND clinical_service_id = v_svc;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % exclusion row(s) after a repeat delete, expected 1', v_n;
  END IF;

  DELETE FROM public.visit_clinical_service_exclusions WHERE excluded_by = 'selftest';
  IF EXISTS (SELECT 1 FROM public.visit_clinical_service_exclusions WHERE excluded_by = 'selftest') THEN
    RAISE EXCEPTION 'ABORT: the self-test row was left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
