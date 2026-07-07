-- Government portal (MJPJY/PMJAY) caret-delimited report imports
CREATE TABLE IF NOT EXISTS public.government_portal_report_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  report_date_label TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  count_dialysis INTEGER NOT NULL DEFAULT 0,
  count_general_medical INTEGER NOT NULL DEFAULT 0,
  count_surgical INTEGER NOT NULL DEFAULT 0,
  count_extension_needed INTEGER NOT NULL DEFAULT 0,
  count_unclassified INTEGER NOT NULL DEFAULT 0,
  whatsapp_medical_patients TEXT,
  whatsapp_urgent_extensions TEXT,
  whatsapp_dialysis_batch_status TEXT,
  fatal_errors TEXT[] NOT NULL DEFAULT '{}',
  missing_columns TEXT[] NOT NULL DEFAULT '{}',
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.government_portal_report_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES public.government_portal_report_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  registration_id TEXT,
  program_id TEXT,
  beneficiary_name TEXT,
  case_type TEXT,
  preauth_initiated_date TEXT,
  speciality_code TEXT,
  category_details TEXT,
  procedure_code TEXT,
  procedure_details TEXT,
  hospital_name TEXT,
  preauth_approved_amount TEXT,
  section TEXT NOT NULL,
  section_label TEXT,
  issues TEXT[] NOT NULL DEFAULT '{}',
  is_hope_hospital BOOLEAN NOT NULL DEFAULT false,
  is_medical_case BOOLEAN NOT NULL DEFAULT false,
  is_dialysis BOOLEAN NOT NULL DEFAULT false,
  days_since_preauth INTEGER,
  extension_needed BOOLEAN NOT NULL DEFAULT false,
  preauth_date_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gov_portal_imports_created_at
  ON public.government_portal_report_imports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gov_portal_rows_import_id
  ON public.government_portal_report_rows(import_id);

CREATE INDEX IF NOT EXISTS idx_gov_portal_rows_registration_id
  ON public.government_portal_report_rows(registration_id);

CREATE INDEX IF NOT EXISTS idx_gov_portal_rows_extension_needed
  ON public.government_portal_report_rows(extension_needed)
  WHERE extension_needed = true;

ALTER TABLE public.government_portal_report_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.government_portal_report_rows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "government_portal_report_imports_all"
    ON public.government_portal_report_imports FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "government_portal_report_rows_all"
    ON public.government_portal_report_rows FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
