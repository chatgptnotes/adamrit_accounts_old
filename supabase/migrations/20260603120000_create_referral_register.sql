-- Referral register for the Relationship Manager page. One row per referred
-- patient. Columns mirror the hospital's handwritten referral register:
-- Sr.No (derived in UI from sort_order), Date of Registration, Patient Name,
-- Paid Amount, Consultant, Referral % (25%/+%), Total Paid Amount (Full &
-- Final), Referral Name, Referral Amount. Referral Amount is auto-computed in
-- the UI (Paid Amount x Referral %) and stored here so totals stay consistent.

create table if not exists public.referral_register (
  id uuid primary key default gen_random_uuid(),
  date_of_registration date,
  patient_name text not null default '',
  paid_amount numeric(12,2) not null default 0,
  consultant text,
  referral_percent numeric(6,2) not null default 0,
  total_paid_amount numeric(12,2) not null default 0,
  referral_name text,
  referral_amount numeric(12,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.referral_register_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_referral_register_touch on public.referral_register;
create trigger trg_referral_register_touch
  before update on public.referral_register
  for each row execute function public.referral_register_touch_updated_at();

alter table public.referral_register enable row level security;

drop policy if exists "referral_register_select" on public.referral_register;
create policy "referral_register_select"
  on public.referral_register for select using (true);

drop policy if exists "referral_register_insert" on public.referral_register;
create policy "referral_register_insert"
  on public.referral_register for insert with check (true);

drop policy if exists "referral_register_update" on public.referral_register;
create policy "referral_register_update"
  on public.referral_register for update using (true) with check (true);

drop policy if exists "referral_register_delete" on public.referral_register;
create policy "referral_register_delete"
  on public.referral_register for delete using (true);

notify pgrst, 'reload schema';
