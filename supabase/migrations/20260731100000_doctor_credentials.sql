-- The signature and stamp that make a clinical document official.
--
-- Discharge summaries and reports go out with nothing identifying the
-- specialist who treated the patient. There is nowhere in the schema to put a
-- signature: doctors are spread across hope_surgeons, hope_consultants,
-- ayushman_surgeons, doctors and more, none of which carry credentials.
--
-- So credentials live in one table keyed by the doctor's name, the same shape
-- as doctor_ledger_map, which already maps surgeons to ledgers by name. That
-- works no matter which of those tables a given document resolved its doctor
-- from.
--
-- signature_url and stamp_url hold scans of the real signature and the real
-- hospital stamp, uploaded by the hospital. A document whose signatory has
-- neither prints a ruled space to be signed and stamped by hand: drawing
-- something that imitates a signature nobody gave would be a forgery, and an
-- obviously unsigned document is the honest outcome.

CREATE TABLE IF NOT EXISTS public.doctor_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_name      TEXT NOT NULL,
  qualification    TEXT,
  registration_no  TEXT,
  specialty        TEXT,
  signature_url    TEXT,
  stamp_url        TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.doctor_credentials IS
  'Signature, stamp and registration details per doctor, matched by name '
  'because doctors are spread across several master tables with no shared id.';

-- One row per doctor, matched case-insensitively, so a document can never find
-- two different signatures for the same name.
CREATE UNIQUE INDEX IF NOT EXISTS doctor_credentials_name_key
  ON public.doctor_credentials (lower(btrim(doctor_name)));

ALTER TABLE public.doctor_credentials ENABLE ROW LEVEL SECURITY;

-- The app authenticates at the application layer and talks to Supabase with the
-- anon key, so policies are permissive here and who may edit credentials is
-- enforced in the UI, matching the other master tables.
DROP POLICY IF EXISTS doctor_credentials_all ON public.doctor_credentials;
CREATE POLICY doctor_credentials_all ON public.doctor_credentials
  FOR ALL USING (true) WITH CHECK (true);

-- Seed a row for every doctor already named on a visit, so the master opens
-- with the people who actually sign documents rather than an empty list.
-- Details and images stay null until somebody fills them in.
INSERT INTO public.doctor_credentials (doctor_name)
SELECT DISTINCT btrim(v.appointment_with)
  FROM public.visits v
 WHERE btrim(COALESCE(v.appointment_with, '')) <> ''
   AND NOT EXISTS (
     SELECT 1 FROM public.doctor_credentials c
      WHERE lower(btrim(c.doctor_name)) = lower(btrim(v.appointment_with)))
ON CONFLICT DO NOTHING;

-- Pick up qualification and specialty where a master already knows them.
UPDATE public.doctor_credentials c
   SET specialty = COALESCE(c.specialty, s.specialty),
       updated_at = now()
  FROM public.hope_surgeons s
 WHERE lower(btrim(s.name)) = lower(btrim(c.doctor_name))
   AND c.specialty IS NULL;

UPDATE public.doctor_credentials c
   SET specialty = COALESCE(c.specialty, d.specialty),
       qualification = COALESCE(c.qualification, d.qualification),
       updated_at = now()
  FROM public.doctors d
 WHERE lower(btrim(d.name)) = lower(btrim(c.doctor_name))
   AND (c.specialty IS NULL OR c.qualification IS NULL);

-- How many signatories exist, and how many can actually sign a document today.
SELECT count(*)                                            AS doctors,
       count(*) FILTER (WHERE signature_url IS NOT NULL)    AS with_signature,
       count(*) FILTER (WHERE stamp_url IS NOT NULL)        AS with_stamp,
       count(*) FILTER (WHERE registration_no IS NOT NULL)  AS with_registration
  FROM public.doctor_credentials
 WHERE is_active;
