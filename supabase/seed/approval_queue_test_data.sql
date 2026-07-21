-- ═══════════════════════════════════════════════════════════════════
-- Payables Approval Queue — TABLE + TEST DATA (one paste, one Run)
-- Run this in the Supabase dashboard SQL Editor.
-- Safe to run twice: table creation is IF NOT EXISTS and the test rows
-- are skipped if TEST-% references already exist.
-- Test rows use tiny amounts (Rs 10/20/30) and are marked TEST so you
-- can delete them after checking.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Table (same as migration 20260721100000_create_approval_queue.sql) ──

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
  constraint approval_queue_distinct_ledgers check (expense_account_id <> party_account_id)
);

alter table public.approval_queue enable row level security;

-- App-layer auth (custom login + anon key), so policies are permissive —
-- matches migration 20260721100000.
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

drop policy if exists "approval_queue_delete" on public.approval_queue;
create policy "approval_queue_delete"
  on public.approval_queue for delete
  using (status = 'PENDING');

create index if not exists approval_queue_status_company_idx
  on public.approval_queue (status, company_id);
create index if not exists approval_queue_created_at_idx
  on public.approval_queue (created_at desc);

-- PostgREST ko naya table dikhane ke liye schema cache reload:
notify pgrst, 'reload schema';

-- ── 2. Test data: one VENDOR + one DOCTOR + one SALARY bill ──────────

do $$
declare
  v_company uuid;
  v_vendor_exp uuid;   v_vendor_party uuid;
  v_doctor_exp uuid;   v_doctor_party uuid;
  v_salary_exp uuid;   v_salary_party uuid;
  v_vendor_exp_name text; v_vendor_party_name text;
  v_doctor_party_name text;
  v_salary_exp_name text; v_salary_party_name text;
begin
  -- The accounting company mapped to the active Tally company.
  select id into v_company from public.companies
   where company_name = 'DRM Hope Hospital Private Limited' and is_active = true
   limit 1;
  if v_company is null then
    raise exception 'Company "DRM Hope Hospital Private Limited" not found';
  end if;

  -- Already seeded? Do nothing.
  if exists (select 1 from public.approval_queue where reference_no like 'TEST-%') then
    raise notice 'Test rows already exist — skipping seed.';
    return;
  end if;

  -- VENDOR: Dr = an indirect-expense ledger, Cr = a Sundry Creditor.
  select id, account_name into v_vendor_exp, v_vendor_exp_name
    from public.chart_of_accounts
   where company_id = v_company and is_active = true
     and (account_group ilike '%indirect expense%' or account_name ilike '%advertisement%')
   order by account_name limit 1;

  select id, account_name into v_vendor_party, v_vendor_party_name
    from public.chart_of_accounts
   where company_id = v_company and is_active = true
     and account_group ilike '%sundry creditor%'
     and id <> v_vendor_exp
   order by account_name limit 1;

  -- DOCTOR: Dr = professional/consultant fee ledger (fallback: any expense),
  -- Cr = a second Sundry Creditor.
  select id into v_doctor_exp
    from public.chart_of_accounts
   where company_id = v_company and is_active = true
     and (account_name ilike '%professional%' or account_name ilike '%consultant%'
          or account_group ilike '%professional%')
   order by account_name limit 1;
  if v_doctor_exp is null then v_doctor_exp := v_vendor_exp; end if;

  select id, account_name into v_doctor_party, v_doctor_party_name
    from public.chart_of_accounts
   where company_id = v_company and is_active = true
     and account_group ilike '%sundry creditor%'
     and id not in (v_doctor_exp, coalesce(v_vendor_party, v_doctor_exp))
   order by account_name limit 1;

  -- SALARY: Dr = a salary-expense-group ledger, Cr = a second ledger from a
  -- salary group (the staff member), fallback: another creditor.
  select id, account_name into v_salary_exp, v_salary_exp_name
    from public.chart_of_accounts
   where company_id = v_company and is_active = true
     and account_group ilike '%salary%'
   order by account_name limit 1;

  select id, account_name into v_salary_party, v_salary_party_name
    from public.chart_of_accounts
   where company_id = v_company and is_active = true
     and account_group ilike '%salary%'
     and id <> v_salary_exp
   order by account_name desc limit 1;
  if v_salary_party is null then v_salary_party := v_doctor_party; end if;

  if v_vendor_exp is null or v_vendor_party is null
     or v_doctor_party is null or v_salary_exp is null then
    raise exception 'Could not find suitable test ledgers for this company';
  end if;

  insert into public.approval_queue
    (company_id, category, party_name, reference_no, amount,
     expense_account_id, party_account_id, narration, created_by)
  values
    (v_company, 'VENDOR', 'TEST ' || coalesce(v_vendor_party_name, 'Vendor'),
     'TEST-VEN-001', 10.00, v_vendor_exp, v_vendor_party,
     'TEST bill — delete after checking', 'test-seed'),
    (v_company, 'DOCTOR', 'TEST Dr ' || coalesce(v_doctor_party_name, 'Doctor'),
     'TEST-DOC-001', 20.00, v_doctor_exp, v_doctor_party,
     'TEST surgery fee — delete after checking', 'test-seed'),
    (v_company, 'SALARY', 'TEST ' || coalesce(v_salary_party_name, 'Staff'),
     'TEST-SAL-001', 30.00, v_salary_exp, v_salary_party,
     'TEST salary — delete after checking', 'test-seed');

  raise notice 'Seeded 3 test bills (TEST-VEN-001 / TEST-DOC-001 / TEST-SAL-001)';
end $$;

-- Verify:
select category, party_name, reference_no, amount, status
  from public.approval_queue
 where reference_no like 'TEST-%'
 order by category;

-- ── Cleanup (baad mein, test check ho jane par) ──────────────────────
-- delete from public.approval_queue where reference_no like 'TEST-%';
-- (Approve kiye hue TEST vouchers ko Vouchers register se cancel karna.)
