-- Designation on the salary sheet rows. The HR profile table carries it, but
-- slips did not — and the sheet is read without joining profiles, since
-- manual and imported rows have no profile at all.

ALTER TABLE public.hr_payroll_slips
  ADD COLUMN IF NOT EXISTS designation TEXT;

NOTIFY pgrst, 'reload schema';
