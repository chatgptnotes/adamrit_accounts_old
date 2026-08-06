-- User Management writes this flag for every new or edited user. Keep this
-- migration idempotent so databases that missed the original HR migration
-- can be repaired safely.
ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS hr_pulse_can_view_all BOOLEAN NOT NULL DEFAULT false;

UPDATE public."User"
   SET hr_pulse_can_view_all = true
 WHERE role IN ('superadmin', 'super_admin', 'ca');

NOTIFY pgrst, 'reload schema';
