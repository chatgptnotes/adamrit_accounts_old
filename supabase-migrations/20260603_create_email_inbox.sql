-- Email inbox table for billing email automation
-- Run this once in Supabase SQL Editor

create table if not exists email_inbox (
  id           uuid primary key default gen_random_uuid(),
  from_name    text,
  from_email   text not null,
  subject      text not null,
  body_preview text,
  body_full    text,
  category     text,
  urgency      text default 'low',
  draft_reply  text,
  status       text not null default 'pending',
  check_date   date not null default current_date,
  check_run    text,
  thread_id    text,
  message_id   text,
  approved_at  timestamptz,
  created_at   timestamptz default now()
);

-- Index for fast lookup by date and status
create index if not exists email_inbox_check_date_idx on email_inbox (check_date);
create index if not exists email_inbox_status_idx on email_inbox (status);

-- Allow anon key to insert and read (for Node.js script)
alter table email_inbox enable row level security;

create policy "allow_all" on email_inbox for all using (true) with check (true);
