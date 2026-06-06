-- Open Dashboard / Deadline Tracking: per-hospital utility-bill tracker.
-- Isolated table — the dashboard reads/writes only this. Hospital scoping is
-- done in the browser (RLS disabled; staff already authenticate via the app's
-- custom auth).

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

-- Most queries filter by hospital + order by due_date asc.
create index if not exists utility_deadlines_hospital_due_idx
  on public.utility_deadlines (hospital_type, due_date);

-- RLS strategy: enable RLS but add a single permissive policy for anon +
-- authenticated. Disabling RLS works in some projects, but Supabase often
-- re-enables it (project default), causing 42501 "new row violates row-level
-- security policy" on insert. A permissive policy is the durable approach.
alter table public.utility_deadlines enable row level security;

drop policy if exists "utility_deadlines anon all" on public.utility_deadlines;
create policy "utility_deadlines anon all"
  on public.utility_deadlines
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.utility_deadlines to anon, authenticated;
