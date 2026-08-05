-- Separate HR Pulse access control for User Management.
--
-- Full HR Pulse visibility is a per-user flag, but only superadmin-class
-- accounts are eligible for it. Everyone else stays self-scoped.

ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS hr_pulse_can_view_all BOOLEAN NOT NULL DEFAULT false;

UPDATE public."User"
   SET hr_pulse_can_view_all = true
 WHERE role IN ('superadmin', 'super_admin');

NOTIFY pgrst, 'reload schema';
