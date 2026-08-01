-- The hospital's own round seal, which is not any one doctor's.
--
-- doctor_credentials answers "who signed this", one row per person. The seal
-- stamped beside that signature belongs to the hospital, and the app serves
-- two of them - Hope and Ayushman, the HospitalType in src/types/hospital.ts.
-- A document should print the seal of the hospital it was raised under, so the
-- seal is keyed by that same hospital type rather than kept as a single global
-- image or bolted onto a doctor's row.

CREATE TABLE IF NOT EXISTS public.hospital_stamps (
  hospital_type  TEXT PRIMARY KEY CHECK (hospital_type IN ('hope', 'ayushman')),
  stamp_url      TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hospital_stamps IS
  'The round hospital seal per hospital type, printed beside the signing '
  'doctor''s own stamp. A hospital with no seal on file prints a blank space.';

ALTER TABLE public.hospital_stamps ENABLE ROW LEVEL SECURITY;

-- Same posture as doctor_credentials: the app authenticates at the application
-- layer and talks to Supabase with the anon key, so the policy is permissive
-- here and who may edit the seal is enforced in the UI.
DROP POLICY IF EXISTS hospital_stamps_all ON public.hospital_stamps;
CREATE POLICY hospital_stamps_all ON public.hospital_stamps
  FOR ALL USING (true) WITH CHECK (true);

-- One row per hospital from the start, so the master shows both slots waiting
-- to be filled rather than an empty screen that looks broken.
INSERT INTO public.hospital_stamps (hospital_type, stamp_url)
VALUES ('hope', NULL), ('ayushman', NULL)
ON CONFLICT (hospital_type) DO NOTHING;

SELECT hospital_type,
       CASE WHEN stamp_url IS NULL THEN 'no seal yet' ELSE 'seal on file' END AS status
  FROM public.hospital_stamps
 ORDER BY hospital_type;
