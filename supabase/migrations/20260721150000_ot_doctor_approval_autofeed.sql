-- OT auto-feed for the payables approval queue.
--
-- When an OT surgery is marked completed (tablet OT Photos tile), a DOCTOR
-- bill is auto-created in approval_queue with amount 0 and possibly-unknown
-- company/ledgers; management fills those in while approving. This migration
-- relaxes approval_queue for such rows and adds the surgeon → ledger mapping
-- table that pre-fills them.

-- ── 1. Relax approval_queue for auto-created PENDING rows ────────────

-- Amount: 0 allowed at creation (approve path enforces > 0 in the service).
alter table public.approval_queue alter column amount set default 0;
alter table public.approval_queue drop constraint if exists approval_queue_amount_check;
alter table public.approval_queue add constraint approval_queue_amount_check check (amount >= 0);

-- Company/ledgers unknown until approval for unmapped surgeons.
alter table public.approval_queue alter column company_id drop not null;
alter table public.approval_queue alter column expense_account_id drop not null;
alter table public.approval_queue alter column party_account_id drop not null;

-- Distinct-ledger rule, null-tolerant.
alter table public.approval_queue drop constraint if exists approval_queue_distinct_ledgers;
alter table public.approval_queue add constraint approval_queue_distinct_ledgers
  check (expense_account_id is null or party_account_id is null or expense_account_id <> party_account_id);

-- Source OT event; the partial unique index makes re-marking a surgery done
-- idempotent (one bill per surgeon per OT row, ever).
alter table public.approval_queue add column if not exists ot_schedule_id uuid;
create unique index if not exists approval_queue_ot_surgeon_uniq
  on public.approval_queue (ot_schedule_id, party_name)
  where ot_schedule_id is not null;

-- ── 2. Surgeon → ledger mapping (one-time setup, per doctor) ─────────

create table if not exists public.doctor_ledger_map (
  id uuid primary key default gen_random_uuid(),
  surgeon_name text not null,
  company_id uuid not null references public.companies(id),
  party_account_id uuid not null references public.chart_of_accounts(id),
  expense_account_id uuid references public.chart_of_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One mapping per doctor, matched case-insensitively.
create unique index if not exists doctor_ledger_map_name_uniq
  on public.doctor_ledger_map (lower(surgeon_name));

alter table public.doctor_ledger_map enable row level security;

-- App authenticates at the application layer (custom login + anon key), so
-- policies are permissive — same as approval_queue.
drop policy if exists doctor_ledger_map_select on public.doctor_ledger_map;
drop policy if exists doctor_ledger_map_insert on public.doctor_ledger_map;
drop policy if exists doctor_ledger_map_update on public.doctor_ledger_map;
drop policy if exists doctor_ledger_map_delete on public.doctor_ledger_map;

create policy doctor_ledger_map_select on public.doctor_ledger_map for select using (true);
create policy doctor_ledger_map_insert on public.doctor_ledger_map for insert with check (true);
create policy doctor_ledger_map_update on public.doctor_ledger_map for update using (true) with check (true);
create policy doctor_ledger_map_delete on public.doctor_ledger_map for delete using (true);

notify pgrst, 'reload schema';
