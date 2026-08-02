-- Make Adamrit the single RMO master for the ecosystem.
--
-- nabh.online kept its own rmo_doctors copy (12 doctors WITH qualification /
-- registration / designation) while Adamrit's hope_rmos had 7 sparse rows —
-- two masters, already diverged. This enriches hope_rmos with the NABH fields,
-- imports nabh.online's richer data, and exposes a read-only view the sister
-- apps can consume over Adamrit's REST API.

ALTER TABLE public.hope_rmos
  ADD COLUMN IF NOT EXISTS emp_id TEXT,
  ADD COLUMN IF NOT EXISTS qualification TEXT,
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS registration_no TEXT,
  ADD COLUMN IF NOT EXISTS doctor_type TEXT;

ALTER TABLE public.ayushman_rmos
  ADD COLUMN IF NOT EXISTS emp_id TEXT,
  ADD COLUMN IF NOT EXISTS qualification TEXT,
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS registration_no TEXT,
  ADD COLUMN IF NOT EXISTS doctor_type TEXT;

-- Import nabh.online's 12-doctor master (source: List of Doctors.docx via
-- nabh.online src/data/rmoDoctorsMaster.ts). Matched on the name ignoring
-- case, dots and spacing; existing rows are enriched, missing ones inserted.
DO $$
DECLARE
  doc RECORD;
  v_id UUID;
BEGIN
  FOR doc IN
    SELECT * FROM (VALUES
      ('H001', 'Dr. Shiraz Khan',       'M.B.B.S', 'RMO / Quality Coordinator', '2001/06/2320',    'Allopathic'),
      ('H002', 'Dr. Sandeep Gajbe',     'M.B.B.S', 'RMO',                       'MMC/2019/12/7373','Allopathic'),
      ('H003', 'Dr. Afzal Shekh',       'M.B.B.S', 'RMO',                       'MCI/09-35333',    'Allopathic'),
      ('H004', 'Dr. Vinod Borkar',      'M.B.B.S', 'RMO',                       '2000/07/2536',    'Allopathic'),
      ('H005', 'Dr. Pranali Gurukar',   'M.B.B.S', 'RMO',                       '2016/09/3816',    'Allopathic'),
      ('H006', 'Dr. Shubham Ingle',     'M.B.B.S', 'RMO',                       '2019/09/6234',    'Allopathic'),
      ('H007', 'Dr. Swapnil Charpe',    'B.H.M.S', 'RMO',                       '44068',           'Non-Allopathic'),
      ('H008', 'Dr. Javed Khan',        'B.H.M.S', 'RMO',                       '61356',           'Non-Allopathic'),
      ('H009', 'Dr. Sharad Kawde',      'B.H.M.S', 'RMO / MRD Incharge',        '20598',           'Non-Allopathic'),
      ('H010', 'Dr. Nitin Arihar',      'B.A.M.S', 'RMO',                       'I-101786-A',      'Non-Allopathic'),
      ('H011', 'Dr. Sachin Gathibande', 'B.H.M.S', 'RMO',                       'A423/2005',       'Non-Allopathic'),
      ('H012', 'Dr. Sikhandar Khan',    'B.U.M.S', 'RMO',                       'I-77705-E',       'Non-Allopathic')
    ) AS t(emp_id, name, qualification, designation, registration_no, doctor_type)
  LOOP
    SELECT id INTO v_id FROM public.hope_rmos
     WHERE regexp_replace(upper(name), '[^A-Z]', '', 'g')
         = regexp_replace(upper(doc.name), '[^A-Z]', '', 'g')
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.hope_rmos (name, is_active, emp_id, qualification, designation, registration_no, doctor_type, daily_remuneration)
      VALUES (doc.name, true, doc.emp_id, doc.qualification, doc.designation, doc.registration_no, doc.doctor_type, 0);
    ELSE
      UPDATE public.hope_rmos
         SET emp_id = COALESCE(emp_id, doc.emp_id),
             qualification = COALESCE(qualification, doc.qualification),
             designation = COALESCE(designation, doc.designation),
             registration_no = COALESCE(registration_no, doc.registration_no),
             doctor_type = COALESCE(doctor_type, doc.doctor_type),
             updated_at = now()
       WHERE id = v_id;
    END IF;
  END LOOP;
END $$;

-- The ecosystem contract: one read-only view over both hospitals' RMO masters.
-- Sister apps (nabh.online first) read this over Adamrit's REST API instead of
-- keeping their own copies.
CREATE OR REPLACE VIEW public.ecosystem_rmo_doctors AS
SELECT id, 'hope' AS hospital, emp_id, name, qualification, designation,
       registration_no, doctor_type, is_active
  FROM public.hope_rmos
UNION ALL
SELECT id, 'ayushman' AS hospital, emp_id, name, qualification, designation,
       registration_no, doctor_type, is_active
  FROM public.ayushman_rmos;

GRANT SELECT ON public.ecosystem_rmo_doctors TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT hospital, count(*) AS doctors, count(*) FILTER (WHERE registration_no IS NOT NULL) AS with_registration
  FROM public.ecosystem_rmo_doctors WHERE is_active GROUP BY hospital;
