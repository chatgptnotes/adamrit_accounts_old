-- Daily Revenue Report uses the application's public User table for login,
-- not auth.users. Store the readable app-user email instead of an incompatible
-- auth.users UUID foreign key.
ALTER TABLE public.daily_revenue_report_approvals
  DROP CONSTRAINT IF EXISTS daily_revenue_report_approvals_approved_by_fkey;

ALTER TABLE public.daily_revenue_report_approvals
  DROP COLUMN IF EXISTS approved_by;

ALTER TABLE public.daily_revenue_report_approvals
  ADD COLUMN IF NOT EXISTS approved_by_email text;

-- Make the new schema available to PostgREST immediately after this migration.
NOTIFY pgrst, 'reload schema';
