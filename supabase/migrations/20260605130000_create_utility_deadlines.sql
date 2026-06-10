-- Open Dashboard / Deadline Tracking: per-hospital utility-bill tracker.
-- Safe to run multiple times — every statement is idempotent.
-- Paste the whole file into Supabase SQL Editor and click Run.

-- 1. Table
create table if not exists public.utility_deadlines (
  id uuid primary key default gen_random_uuid(),
  hospital_type text,
  name text not null,
  bill_type text not null default 'other',
  amount numeric(12, 2) not null default 0,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  recurring boolean not null default true,
  notes text,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Index for the hot query: filter by hospital + order by due_date asc.
create index if not exists utility_deadlines_hospital_due_idx
  on public.utility_deadlines (hospital_type, due_date);

-- 3. RLS — enable + permissive policy.
--    Supabase auto-enables RLS on new tables, so a permissive policy is the
--    durable way to let the browser anon key read/write.
alter table public.utility_deadlines enable row level security;

drop policy if exists "utility_deadlines anon all" on public.utility_deadlines;
create policy "utility_deadlines anon all"
  on public.utility_deadlines
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 4. Grants (defence in depth — RLS already allows; grants ensure no
--    "permission denied" before the policy is even checked).
grant select, insert, update, delete on public.utility_deadlines to anon, authenticated;
