-- Screenshot uploads of the NHA provider portal's "Preauthorization to be
-- Submitted" card list. Kept separate from government_portal_report_imports
-- (which is the caret-delimited CSV/TXT export) since this is an AI-vision
-- extraction off a dashboard screenshot instead.

CREATE TABLE IF NOT EXISTS public.government_portal_preauth_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.government_portal_preauth_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES public.government_portal_preauth_uploads(id) ON DELETE CASCADE,
  patient_name TEXT,
  age_label TEXT,
  gender TEXT,
  program_id TEXT,
  registration_id TEXT,
  registration_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gov_portal_preauth_uploads_created_at
  ON public.government_portal_preauth_uploads(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gov_portal_preauth_rows_upload_id
  ON public.government_portal_preauth_rows(upload_id);

CREATE INDEX IF NOT EXISTS idx_gov_portal_preauth_rows_status
  ON public.government_portal_preauth_rows(status);

ALTER TABLE public.government_portal_preauth_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.government_portal_preauth_rows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "government_portal_preauth_uploads_all"
    ON public.government_portal_preauth_uploads FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "government_portal_preauth_rows_all"
    ON public.government_portal_preauth_rows FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
