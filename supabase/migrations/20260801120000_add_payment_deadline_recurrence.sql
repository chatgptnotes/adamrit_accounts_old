-- Add recurrence scheduling to payment_deadlines, like Google Calendar.
--
-- A deadline can now repeat: daily, weekly (on chosen weekdays), monthly
-- (on a day-of-month), or yearly. The director dashboard uses these columns
-- to auto-advance the due_date after a deadline is marked paid, so recurring
-- obligations (EMI, electricity, rent, salaries) never have to be re-entered.
--
-- recurrence_type: none | daily | weekly | monthly | yearly
-- recurrence_interval: every N units (e.g. every 2 weeks = interval 2)
-- recurrence_weekdays: array of weekday numbers (0=Sun..6=Sat) for weekly
-- recurrence_day_of_month: day 1-31 for monthly (28 used for shorter months)
-- recurrence_end_date: optional cutoff; NULL = repeats forever
-- last_recycled_at: when the due_date was last auto-advanced (audit)

ALTER TABLE public.payment_deadlines
  ADD COLUMN IF NOT EXISTS recurrence_type TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_type IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1
    CHECK (recurrence_interval >= 1),
  ADD COLUMN IF NOT EXISTS recurrence_weekdays INTEGER[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recurrence_day_of_month INTEGER DEFAULT NULL
    CHECK (recurrence_day_of_month IS NULL OR (recurrence_day_of_month BETWEEN 1 AND 31)),
  ADD COLUMN IF NOT EXISTS recurrence_end_date DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_recycled_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.payment_deadlines.recurrence_type IS
  'none = one-off. daily/weekly/monthly/yearly auto-advances due_date when marked paid.';
COMMENT ON COLUMN public.payment_deadlines.recurrence_weekdays IS
  'For weekly recurrence: array of 0=Sun..6=Sat the deadline repeats on.';
COMMENT ON COLUMN public.payment_deadlines.recurrence_day_of_month IS
  'For monthly recurrence: day 1-31 (28 used when the month is shorter).';
COMMENT ON COLUMN public.payment_deadlines.recurrence_end_date IS
  'Optional cutoff after which the deadline stops repeating. NULL = forever.';