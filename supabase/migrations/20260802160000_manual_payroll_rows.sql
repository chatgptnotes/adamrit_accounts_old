-- Manual rows on the Salary Sheet.
--
-- Slips normally arrive from the HRPulse portal sync, but not every staffer
-- is on the portal and corrections happen at the desk. The sheet therefore
-- needs rows entered by hand — name, ledger-matched like any other row, plus
-- the figures the desk actually reasons from: days attended, duties done,
-- the base monthly salary, and what is payable this month.
--
-- hr_payroll_slips was select-only for the app (the sync wrote it from the
-- server side), so manual entry also needs insert/update policies, in the
-- same trust model as the rest of the HR portal tables.

ALTER TABLE public.hr_payroll_slips
  ADD COLUMN IF NOT EXISTS days_present NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS duty_count NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS base_monthly_salary NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS entry_source TEXT NOT NULL DEFAULT 'hrpulse';

COMMENT ON COLUMN public.hr_payroll_slips.entry_source IS
  'hrpulse = synced from the HR portal; manual = typed on the Salary Sheet. The sync upserts by (employee_id, payroll_month), and manual rows carry no employee_id, so a sync never overwrites a manual row.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_payroll_slips' AND policyname = 'hr_payroll_slips_portal_insert') THEN
    CREATE POLICY "hr_payroll_slips_portal_insert" ON public.hr_payroll_slips FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_payroll_slips' AND policyname = 'hr_payroll_slips_portal_update') THEN
    CREATE POLICY "hr_payroll_slips_portal_update" ON public.hr_payroll_slips FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
