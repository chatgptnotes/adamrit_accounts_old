-- Payables approval queue: vendor bills / doctor fees / staff salaries wait
-- here for management approval. On approval a JOURNAL voucher (Dr expense,
-- Cr party) is posted into vouchers/voucher_entries; when the party collects,
-- a PAYMENT voucher (Dr party, Cr cash/bank) knocks the bill off. The posted
-- voucher ids are stored back on the row so approve/pay can never run twice.

create table if not exists public.approval_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  category text not null check (category in ('VENDOR', 'DOCTOR', 'SALARY')),
  party_name text not null,
  reference_no text,
  amount numeric(12,2) not null check (amount > 0),
  expense_account_id uuid not null references public.chart_of_accounts(id),
  party_account_id uuid not null references public.chart_of_accounts(id),
  invoice_url text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  narration text,
  rejection_reason text,
  jv_voucher_id uuid references public.vouchers(id),
  is_paid boolean not null default false,
  payment_voucher_id uuid references public.vouchers(id),
  created_by text,
  approved_by text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  -- A JV debiting and crediting the same ledger is meaningless.
  constraint approval_queue_distinct_ledgers check (expense_account_id <> party_account_id)
);

alter table public.approval_queue enable row level security;

-- The app authenticates at the application layer (custom login) and talks to
-- Supabase with the anon key, so policies are permissive here; approval
-- authority is enforced in the UI via accounting rights, matching the rest
-- of the accounting module.
drop policy if exists "approval_queue_select" on public.approval_queue;
create policy "approval_queue_select"
  on public.approval_queue for select
  using (true);

drop policy if exists "approval_queue_insert" on public.approval_queue;
create policy "approval_queue_insert"
  on public.approval_queue for insert
  with check (true);

drop policy if exists "approval_queue_update" on public.approval_queue;
create policy "approval_queue_update"
  on public.approval_queue for update
  using (true)
  with check (true);

-- Rows may only be deleted while still pending (approved rows are frozen —
-- their JV already exists in the books).
drop policy if exists "approval_queue_delete" on public.approval_queue;
create policy "approval_queue_delete"
  on public.approval_queue for delete
  using (status = 'PENDING');

-- The tab lists by status within the selected company.
create index if not exists approval_queue_status_company_idx
  on public.approval_queue (status, company_id);
create index if not exists approval_queue_created_at_idx
  on public.approval_queue (created_at desc);
