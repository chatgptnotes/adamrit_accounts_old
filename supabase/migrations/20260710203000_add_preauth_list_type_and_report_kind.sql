-- Let the same preauth-screenshot and CSV-import tables track more than one
-- lane: "Preauthorization to be Submitted" vs "Preauthorization Pending"
-- screenshots, and "Under Treatment" vs "Claims to be Submitted" CSVs.
-- Existing rows default to the lane they already represented.

ALTER TABLE public.government_portal_preauth_uploads
  ADD COLUMN IF NOT EXISTS list_type TEXT NOT NULL DEFAULT 'to_be_submitted';

CREATE INDEX IF NOT EXISTS idx_gov_portal_preauth_uploads_list_type
  ON public.government_portal_preauth_uploads(list_type);

ALTER TABLE public.government_portal_report_imports
  ADD COLUMN IF NOT EXISTS report_kind TEXT NOT NULL DEFAULT 'under_treatment';

CREATE INDEX IF NOT EXISTS idx_gov_portal_imports_report_kind
  ON public.government_portal_report_imports(report_kind);

NOTIFY pgrst, 'reload schema';
