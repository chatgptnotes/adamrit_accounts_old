-- MD/director routing: directors (hospital MDs) only receive IMPORTANT items,
-- plus a daily important-only summary. Two flags drive it:
--   slack_recipients.is_director  — this recipient is an MD (important-only)
--   utility_deadlines.important   — this reminder is high-priority (MD-level)
-- Final importance also factors amount/overdue at send time (see the crons).
-- Idempotent — safe to run multiple times.

alter table public.slack_recipients
  add column if not exists is_director boolean not null default false;

alter table public.utility_deadlines
  add column if not exists important boolean not null default false;
