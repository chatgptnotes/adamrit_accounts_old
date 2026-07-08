-- Persist editable status for each government portal yojna patient row.
ALTER TABLE public.government_portal_report_rows
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  ALTER TABLE public.government_portal_report_rows
    ADD CONSTRAINT government_portal_report_rows_status_check
    CHECK (status IN ('pending', 'extension_requested', 'approved', 'rejected', 'closed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_gov_portal_rows_status
  ON public.government_portal_report_rows(status);
