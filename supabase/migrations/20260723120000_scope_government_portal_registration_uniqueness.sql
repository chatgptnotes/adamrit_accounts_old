-- Keep a registration unique within an import, while allowing the same
-- patient to be represented in later portal imports for history and alerts.
DROP INDEX IF EXISTS public.idx_gov_portal_rows_registration_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_portal_rows_import_registration_unique
  ON public.government_portal_report_rows(import_id, registration_id)
  WHERE registration_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
