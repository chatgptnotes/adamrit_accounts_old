-- Azher's billing tick-off.
--
-- The billing desk needs to clear a discharged patient off its worklist once the
-- bill is done. visits.bill_paid cannot carry that: it is already true on every
-- recently discharged visit (all 42 Hope discharges in the last 7 days) before
-- the billing desk ever sees the patient, so it says nothing about whether the
-- bill was actually raised. This column is written only by the tile's
-- "Billing done" button.

alter table public.visits
  add column if not exists billing_cleared_at timestamptz;

comment on column public.visits.billing_cleared_at is
  'Set when the billing desk confirms the bill is done and clears the patient off the recently-discharged worklist. Distinct from bill_paid, which is populated elsewhere and is not a reliable billing signal.';

-- Supports the worklist query: recent discharges not yet cleared.
create index if not exists idx_visits_billing_cleared_at
  on public.visits (discharge_date desc)
  where billing_cleared_at is null;
