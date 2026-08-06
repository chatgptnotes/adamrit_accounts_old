-- Diksha's front-office step, before a dialysis patient reaches the machine.
--
-- The rule this enforces: the thumb impression is taken FIRST, and the printed
-- slip is what Rakesh accepts as authority to start the session. Without a
-- record of the thumb there is nothing to stop a patient going straight to
-- dialysis, which is what this exists to prevent.
--
-- One row per dialysis visit. The thumb image itself goes to file_uploads with
-- every other patient document; only the fact and the time live here.
--
-- Session billing is NOT touched: dialysis_session_billing (one row per billed
-- dialysis visit) already exists and stays the single record of what is
-- claimed.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

CREATE TABLE IF NOT EXISTS public.dialysis_front_office (
  visit_id        UUID PRIMARY KEY REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES public.patients(id),
  hospital_name   TEXT,
  thumb_done_at   TIMESTAMPTZ,
  thumb_file_url  TEXT,
  thumb_by        TEXT,
  slip_printed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialysis_front_office_patient
  ON public.dialysis_front_office (patient_id);

ALTER TABLE public.dialysis_front_office ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on dialysis_front_office"
  ON public.dialysis_front_office;
CREATE POLICY "Allow all operations on dialysis_front_office"
  ON public.dialysis_front_office FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_dialysis_front_office_updated_at
  ON public.dialysis_front_office;
CREATE TRIGGER update_dialysis_front_office_updated_at
  BEFORE UPDATE ON public.dialysis_front_office
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';

DO $verify$
DECLARE
  v_visit UUID;
  v_read  INT;
BEGIN
  SELECT id INTO v_visit FROM public.visits LIMIT 1;
  IF v_visit IS NULL THEN
    RAISE NOTICE 'OK — table created (no visits to probe with)';
    RETURN;
  END IF;

  -- Recording the thumb twice for one visit must update, never duplicate.
  INSERT INTO public.dialysis_front_office (visit_id, thumb_done_at, thumb_by)
  VALUES (v_visit, now(), '__verify__')
  ON CONFLICT (visit_id) DO UPDATE SET thumb_done_at = now();
  INSERT INTO public.dialysis_front_office (visit_id, thumb_done_at, thumb_by)
  VALUES (v_visit, now(), '__verify__')
  ON CONFLICT (visit_id) DO UPDATE SET thumb_done_at = now();

  SELECT count(*) INTO v_read FROM public.dialysis_front_office WHERE visit_id = v_visit;
  IF v_read <> 1 THEN
    RAISE EXCEPTION 'recording the thumb twice produced % rows', v_read;
  END IF;
  DELETE FROM public.dialysis_front_office WHERE thumb_by = '__verify__';

  RAISE NOTICE 'OK — dialysis_front_office is one row per visit';
END;
$verify$;
