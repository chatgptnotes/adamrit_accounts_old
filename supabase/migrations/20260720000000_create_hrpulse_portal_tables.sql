-- Adamrit-side HRPulse sync contract for tablet HR portal.
-- External HRPulse credentials must be stored as Supabase secrets / server env vars,
-- never in the frontend bundle.

create table if not exists hr_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id text unique not null,
  employee_name text not null,
  employee_email text,
  mobile_number text,
  department text,
  designation text,
  role text,
  leave_balance jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  employee_email text,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
);

create table if not exists hr_payroll_slips (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  employee_email text,
  payroll_month date not null,
  gross_salary numeric(12,2) default 0,
  deductions numeric(12,2) default 0,
  net_salary numeric(12,2) default 0,
  slip_url text,
  source_payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  verified_by text,
  verified_at timestamptz,
  unique(employee_id, payroll_month)
);

create table if not exists hr_sync_events (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'HRPulse',
  status text not null check (status in ('success', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_synced integer not null default 0,
  message text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_hr_employee_profiles_email on hr_employee_profiles(lower(employee_email));
create index if not exists idx_hr_leave_requests_employee on hr_leave_requests(employee_id, start_date desc);
create index if not exists idx_hr_leave_requests_status on hr_leave_requests(status, requested_at desc);
create index if not exists idx_hr_payroll_slips_employee_month on hr_payroll_slips(employee_id, payroll_month desc);

alter table hr_employee_profiles enable row level security;
alter table hr_leave_requests enable row level security;
alter table hr_payroll_slips enable row level security;
alter table hr_sync_events enable row level security;

-- The current Adamrit login layer stores app users outside Supabase JWT claims.
-- These policies keep the tablet portal functional while the UI enforces role
-- filtering. Move to claim-based RLS when HRPulse users are migrated to Supabase Auth.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_employee_profiles' and policyname = 'hr_employee_profiles_portal_access') then
    create policy "hr_employee_profiles_portal_access" on hr_employee_profiles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_leave_requests' and policyname = 'hr_leave_requests_portal_select') then
    create policy "hr_leave_requests_portal_select" on hr_leave_requests for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_leave_requests' and policyname = 'hr_leave_requests_portal_insert') then
    create policy "hr_leave_requests_portal_insert" on hr_leave_requests for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_leave_requests' and policyname = 'hr_leave_requests_portal_update') then
    create policy "hr_leave_requests_portal_update" on hr_leave_requests for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_payroll_slips' and policyname = 'hr_payroll_slips_portal_access') then
    create policy "hr_payroll_slips_portal_access" on hr_payroll_slips for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hr_sync_events' and policyname = 'hr_sync_events_admin_access') then
    create policy "hr_sync_events_admin_access" on hr_sync_events for select using (true);
  end if;
end $$;
