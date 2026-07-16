-- Prevent duplicate registration_id in government_portal_report_rows.
-- Partial unique index: only enforces uniqueness for non-null values.
-- If duplicates already exist, the index creation will fail — clean them first.

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_portal_rows_registration_id_unique
    ON public.government_portal_report_rows(registration_id)
    WHERE registration_id IS NOT NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
