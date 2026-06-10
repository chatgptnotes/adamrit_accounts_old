-- Exact-time reminders for utility_deadlines.
-- notify_at: when to fire a one-off reminder (NULL = no exact-time reminder,
--   the daily 9 AM digest still covers it).
-- notify_sent_at: set once the exact-time reminder has been posted, so the
--   15-minute fire-due-reminders cron never sends it twice.
-- Additive + idempotent — does not touch existing rows or the daily digest.

ALTER TABLE public.utility_deadlines
  ADD COLUMN IF NOT EXISTS notify_at      timestamptz,
  ADD COLUMN IF NOT EXISTS notify_sent_at timestamptz;

-- Speeds up the cron's "due now and not yet sent" lookup.
CREATE INDEX IF NOT EXISTS idx_utility_deadlines_notify_at
  ON public.utility_deadlines (notify_at)
  WHERE notify_at IS NOT NULL AND notify_sent_at IS NULL;
