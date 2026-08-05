-- Private identity and notification bridge for the Tablet HR Pulse portal.
-- The application uses a custom signed session rather than Supabase Auth, so
-- employee-scoped reads and writes are performed by api/hr-pulse.ts with the
-- service role after validating the hmis_session cookie.

ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS employee_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_employee_id
  ON public."User" (employee_id)
  WHERE employee_id IS NOT NULL AND btrim(employee_id) <> '';

CREATE TABLE IF NOT EXISTS public.hr_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'HRPulse',
  source_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_notifications_employee_created
  ON public.hr_notifications(employee_id, created_at DESC);

ALTER TABLE public.hr_notifications ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies are intentional. HR Pulse data is available
-- only through the authenticated server endpoint; the service role is used by
-- the HRPulse sync process and api/hr-pulse.ts.

DROP POLICY IF EXISTS "hr_employee_profiles_portal_access" ON public.hr_employee_profiles;
DROP POLICY IF EXISTS "hr_leave_requests_portal_select" ON public.hr_leave_requests;
DROP POLICY IF EXISTS "hr_leave_requests_portal_insert" ON public.hr_leave_requests;
DROP POLICY IF EXISTS "hr_leave_requests_portal_update" ON public.hr_leave_requests;
DROP POLICY IF EXISTS "hr_payroll_slips_portal_access" ON public.hr_payroll_slips;
DROP POLICY IF EXISTS "hr_sync_events_admin_access" ON public.hr_sync_events;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.hr_notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
