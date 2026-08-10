-- Optional deduction on a Daily Revenue Report row.
--
-- Some bills carry a cost the hospital does not want the referee's cut
-- calculated on — an expensive investigation, most often. The report row
-- gains an amount, a reason, and a switch: the person filling it in and the
-- person approving it can each choose to apply the deduction or ignore it.
--
-- The deduction reduces ONLY the base the RM cut is worked out on. The cost
-- column keeps showing what was billed, so revenue totals and the Director
-- Dashboard are untouched — only the commission shrinks:
--
--     cut = (cost - deduction, when applied) x rm commission %
--
-- deduction_applied is the switch, kept separate from the amount so an
-- ignored deduction still shows the figure and the reason someone typed.
-- A reason is required whenever it is applied — enforced by the CHECK below
-- as well as in the UI, so it holds however the row is written.
--
-- Apply with: python3 scripts/apply-migration.py \
--   supabase/migrations/20260810110000_daily_revenue_deductions.sql

ALTER TABLE public.daily_revenue_entries
  ADD COLUMN IF NOT EXISTS deduction NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduction_reason TEXT,
  ADD COLUMN IF NOT EXISTS deduction_applied BOOLEAN NOT NULL DEFAULT false;

-- A deduction may not be negative, and an applied one must say why.
DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.daily_revenue_entries'::regclass
       AND conname = 'daily_revenue_entries_deduction_sane'
  ) THEN
    ALTER TABLE public.daily_revenue_entries
      ADD CONSTRAINT daily_revenue_entries_deduction_sane
      CHECK (
        deduction >= 0
        AND (
          deduction_applied = false
          OR (deduction > 0 AND coalesce(btrim(deduction_reason), '') <> '')
        )
      );
  END IF;
END
$constraints$;

NOTIFY pgrst, 'reload schema';

DO $verify$
DECLARE
  v_cols INTEGER;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'daily_revenue_entries'
     AND column_name IN ('deduction', 'deduction_reason', 'deduction_applied');
  IF v_cols <> 3 THEN
    RAISE EXCEPTION 'Expected 3 deduction columns, found %', v_cols;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.daily_revenue_entries'::regclass
       AND conname = 'daily_revenue_entries_deduction_sane'
  ) THEN
    RAISE EXCEPTION 'The deduction CHECK constraint was not created';
  END IF;

  RAISE NOTICE 'Deduction columns and constraint in place.';
END
$verify$;
