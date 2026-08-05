-- Corporate scheme framework: additive and isolated.
-- This migration does not alter, update, or delete data in any existing HMIS table.

CREATE TABLE IF NOT EXISTS public.corporate_schemes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT,
  import_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  categories JSONB NOT NULL DEFAULT '["Dialysis", "General Surgery", "General Non-Dialysis", "Unclassified"]'::jsonb,
  business_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corporate_scheme_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code TEXT NOT NULL REFERENCES public.corporate_schemes(scheme_code) ON DELETE RESTRICT,
  record_key TEXT NOT NULL,
  source_file_name TEXT,
  source_row_number INTEGER,
  imported_by TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_id TEXT,
  registration_id TEXT,
  uhid TEXT,
  patient_name TEXT NOT NULL,
  admission_date DATE,
  discharge_date DATE,
  category TEXT NOT NULL DEFAULT 'Unclassified',
  status TEXT NOT NULL DEFAULT 'pending',
  matched_patient_id UUID,
  matched_visit_id UUID,
  match_method TEXT,
  match_confidence TEXT NOT NULL DEFAULT 'unmatched',
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corporate_scheme_records_record_key_unique UNIQUE (scheme_code, record_key),
  CONSTRAINT corporate_scheme_records_confidence_check
    CHECK (match_confidence IN ('unmatched', 'matched', 'ambiguous', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_corporate_scheme_records_scheme_imported
  ON public.corporate_scheme_records(scheme_code, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_corporate_scheme_records_scheme_status
  ON public.corporate_scheme_records(scheme_code, status);
CREATE INDEX IF NOT EXISTS idx_corporate_scheme_records_scheme_category
  ON public.corporate_scheme_records(scheme_code, category);
CREATE INDEX IF NOT EXISTS idx_corporate_scheme_records_patient_link
  ON public.corporate_scheme_records(matched_patient_id)
  WHERE matched_patient_id IS NOT NULL;

ALTER TABLE public.corporate_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_scheme_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "corporate_schemes_authenticated_all"
    ON public.corporate_schemes FOR ALL
    TO public USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "corporate_scheme_records_authenticated_all"
    ON public.corporate_scheme_records FOR ALL
    TO public USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.corporate_schemes (scheme_code, display_name)
VALUES
  ('ECHS', 'ECHS'),
  ('ESIC', 'ESIC'),
  ('WCL', 'WCL'),
  ('MPKAY', 'MPKAY')
ON CONFLICT (scheme_code) DO NOTHING;
