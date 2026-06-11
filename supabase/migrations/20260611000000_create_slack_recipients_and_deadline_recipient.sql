-- Per-recipient deadline reminders: a small roster of Slack targets (people or
-- channels) that a reminder can be addressed to, plus a recipient_id link on
-- utility_deadlines. Safe to run multiple times — every statement is idempotent.
-- Paste the whole file into Supabase SQL Editor and click Run.

-- 1. Roster table
create table if not exists public.slack_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- display, e.g. 'Murli sir'
  aliases text[] not null default '{}',     -- match tokens, e.g. {murli,murali}
  slack_target text,                        -- Slack user ID (U…) or channel ID (C…); null = name-only
  kind text not null default 'dm' check (kind in ('dm', 'channel')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. RLS — enable + permissive policy (mirrors utility_deadlines).
alter table public.slack_recipients enable row level security;

drop policy if exists "slack_recipients anon all" on public.slack_recipients;
create policy "slack_recipients anon all"
  on public.slack_recipients
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.slack_recipients to anon, authenticated;

-- 3. Link a deadline to a recipient (nullable = goes to the shared channel).
alter table public.utility_deadlines
  add column if not exists recipient_id uuid references public.slack_recipients(id);

create index if not exists utility_deadlines_recipient_idx
  on public.utility_deadlines (recipient_id);
