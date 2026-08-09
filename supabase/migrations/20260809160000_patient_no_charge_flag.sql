-- Patients who must not be charged.
--
-- Two situations, one rule. A panel patient from whom the hospital has
-- already taken money over and above what the panel allows has had the whole
-- cost collected as a package — charging again is charging twice. A VIP the
-- hospital may owe money to must not be charged either. In both cases the
-- people at the counter are the ones who need to know, and today nothing
-- tells them.
--
-- The flag is per PATIENT, not per visit: "we owe this person" and "we
-- already took the package off them" both follow the person, and the counter
-- screens that must show it are patient-centric.
--
-- One active flag at a time per patient. Lifting a flag deactivates the row
-- rather than deleting it, so who allowed a concession, and when it stopped,
-- stays answerable.
--
-- Safe to run twice. Applied through apply_migration(), which supplies the
-- transaction, so this file carries no BEGIN/COMMIT of its own.

CREATE TABLE IF NOT EXISTS public.patient_no_charge_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- PACKAGE — everything already collected as a package.
  -- VIP      — do not bill; the hospital may owe them.
  reason         TEXT NOT NULL CHECK (reason IN ('PACKAGE', 'VIP')),
  note           TEXT,
  authorised_by  TEXT NOT NULL CHECK (btrim(authorised_by) <> ''),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_at      TIMESTAMPTZ,
  lifted_by      TEXT
);

-- One live flag per patient; lifted ones accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_no_charge_active
  ON public.patient_no_charge_flags (patient_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_patient_no_charge_patient
  ON public.patient_no_charge_flags (patient_id);

DROP TRIGGER IF EXISTS update_patient_no_charge_flags_updated_at
  ON public.patient_no_charge_flags;
CREATE TRIGGER update_patient_no_charge_flags_updated_at
  BEFORE UPDATE ON public.patient_no_charge_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.patient_no_charge_flags ENABLE ROW LEVEL SECURITY;
-- The app authenticates at the application layer (custom login + anon key),
-- so policies are permissive, as on the other operational tables.
DROP POLICY IF EXISTS "Allow all operations on patient_no_charge_flags"
  ON public.patient_no_charge_flags;
CREATE POLICY "Allow all operations on patient_no_charge_flags"
  ON public.patient_no_charge_flags FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_patient UUID;
  v_first   UUID;
BEGIN
  SELECT id INTO v_patient FROM public.patients LIMIT 1;
  IF v_patient IS NULL THEN
    RAISE NOTICE 'no patients to probe against — structure created';
    RETURN;
  END IF;

  INSERT INTO public.patient_no_charge_flags (patient_id, reason, authorised_by, created_by)
  VALUES (v_patient, 'PACKAGE', 'migration-verify', 'migration-verify')
  RETURNING id INTO v_first;

  -- A second ACTIVE flag on the same patient must be refused.
  BEGIN
    INSERT INTO public.patient_no_charge_flags (patient_id, reason, authorised_by, created_by)
    VALUES (v_patient, 'VIP', 'migration-verify', 'migration-verify');
    RAISE EXCEPTION 'a second active flag was allowed';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Once lifted, a fresh flag is allowed again.
  UPDATE public.patient_no_charge_flags
     SET is_active = false, lifted_at = now(), lifted_by = 'migration-verify'
   WHERE id = v_first;
  INSERT INTO public.patient_no_charge_flags (patient_id, reason, authorised_by, created_by)
  VALUES (v_patient, 'VIP', 'migration-verify', 'migration-verify');

  -- An unauthorised flag must be refused.
  BEGIN
    INSERT INTO public.patient_no_charge_flags (patient_id, reason, authorised_by, created_by)
    VALUES (v_patient, 'VIP', '   ', 'migration-verify');
    RAISE EXCEPTION 'a flag with no approver was allowed';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN unique_violation THEN NULL;
  END;

  -- Leave nothing behind.
  DELETE FROM public.patient_no_charge_flags WHERE created_by = 'migration-verify';
  RAISE NOTICE 'OK — one active no-charge flag per patient, approver required';
END;
$verify$;
