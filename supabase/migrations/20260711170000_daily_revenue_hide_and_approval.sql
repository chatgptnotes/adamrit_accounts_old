-- Persist row visibility for the Daily Revenue Report without modifying the
-- source visit. A hidden visit can be restored later from the report itself.
ALTER TABLE public.daily_revenue_entries
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS daily_revenue_entries_hidden_idx
  ON public.daily_revenue_entries (entry_date, is_hidden);

-- A report is approved once per date. Keeping this separate from individual
-- row overrides lets an entirely auto-generated report be approved as well.
CREATE TABLE IF NOT EXISTS public.daily_revenue_report_approvals (
  entry_date date PRIMARY KEY,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Also cover projects where the table was created manually before this
-- migration. Newer installations already have the primary key above.
CREATE UNIQUE INDEX IF NOT EXISTS daily_revenue_report_approvals_entry_date_uidx
  ON public.daily_revenue_report_approvals (entry_date);

ALTER TABLE public.daily_revenue_report_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_revenue_report_approvals_select" ON public.daily_revenue_report_approvals;
CREATE POLICY "daily_revenue_report_approvals_select"
  ON public.daily_revenue_report_approvals FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "daily_revenue_report_approvals_insert" ON public.daily_revenue_report_approvals;
CREATE POLICY "daily_revenue_report_approvals_insert"
  ON public.daily_revenue_report_approvals FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "daily_revenue_report_approvals_update" ON public.daily_revenue_report_approvals;
CREATE POLICY "daily_revenue_report_approvals_update"
  ON public.daily_revenue_report_approvals FOR UPDATE
  USING (true)
  WITH CHECK (true);
