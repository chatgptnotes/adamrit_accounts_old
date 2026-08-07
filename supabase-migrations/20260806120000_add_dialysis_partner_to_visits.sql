alter table public.visits
  add column if not exists dialysis_partner text;

create index if not exists visits_dialysis_partner_idx
  on public.visits (visit_type, dialysis_partner);
