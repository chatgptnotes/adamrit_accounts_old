-- Manual workflow status per visit, selected in the Advance Statement Report.
-- Drives the Overview "Reports" section (Approval/Extension/Discharge/Bill/Submission/Payment reports).
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS workflow_status text;
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS workflow_status_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_visits_workflow_status ON public.visits (workflow_status) WHERE workflow_status IS NOT NULL;

NOTIFY pgrst, 'reload schema';
