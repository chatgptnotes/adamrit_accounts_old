-- Create visit_diagnoses junction table
create table public.visit_diagnoses (
  id uuid not null default gen_random_uuid (),
  visit_id uuid not null,
  diagnosis_id uuid not null,
  is_primary boolean null default false,
  notes text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint visit_diagnoses_pkey primary key (id),
  constraint visit_diagnoses_visit_id_fkey foreign key (visit_id) references visits (id) on delete cascade,
  constraint visit_diagnoses_diagnosis_id_fkey foreign key (diagnosis_id) references diagnoses (id) on delete cascade
) tablespace pg_default;

-- Create indexes for better performance
create index idx_visit_diagnoses_visit_id on public.visit_diagnoses (visit_id);
create index idx_visit_diagnoses_diagnosis_id on public.visit_diagnoses (diagnosis_id);

-- Add unique constraint to prevent duplicate diagnosis for same visit
create unique index idx_visit_diagnoses_unique on public.visit_diagnoses (visit_id, diagnosis_id);

-- Enable RLS (Row Level Security)
alter table public.visit_diagnoses enable row level security;

-- Create RLS policies (adjust as needed based on your auth setup)
create policy "Enable read access for all users" on public.visit_diagnoses
  for select using (true);

create policy "Enable insert access for all users" on public.visit_diagnoses
  for insert with check (true);

create policy "Enable update access for all users" on public.visit_diagnoses
  for update using (true);

create policy "Enable delete access for all users" on public.visit_diagnoses
  for delete using (true);
