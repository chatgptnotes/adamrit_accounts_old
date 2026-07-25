-- Append-only display overrides for the Amount Paid row on /invoice/:visitId.
-- This never changes advance_payment, final_payments, or any accounting totals.

create table if not exists public.invoice_amount_paid_override_events (
  id uuid primary key default gen_random_uuid(),
  visit_id text not null,
  action text not null check (action in ('set', 'restore')),
  display_amount numeric(14, 2),
  created_by_email text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint invoice_amount_paid_override_event_value_check check (
    (
      action = 'set'
      and display_amount is not null
      and display_amount >= 0
      and display_amount = round(display_amount, 2)
    )
    or
    (
      action = 'restore'
      and display_amount is null
    )
  ),
  constraint invoice_amount_paid_override_cmd_email_check check (
    lower(trim(created_by_email)) = 'cmd@hopehospital.com'
  )
);

create index if not exists invoice_amount_paid_override_events_visit_created_idx
  on public.invoice_amount_paid_override_events (visit_id, created_at desc);

alter table public.invoice_amount_paid_override_events enable row level security;

drop policy if exists "invoice amount override read" on public.invoice_amount_paid_override_events;
create policy "invoice amount override read"
  on public.invoice_amount_paid_override_events
  for select
  to anon, authenticated
  using (true);

drop policy if exists "invoice amount override append" on public.invoice_amount_paid_override_events;
create policy "invoice amount override append"
  on public.invoice_amount_paid_override_events
  for insert
  to anon, authenticated
  with check (
    lower(trim(created_by_email)) = 'cmd@hopehospital.com'
    and action in ('set', 'restore')
  );

grant select, insert on public.invoice_amount_paid_override_events to anon, authenticated;

comment on table public.invoice_amount_paid_override_events is
  'Append-only Amount Paid display overrides for invoices; accounting payment records remain authoritative.';
