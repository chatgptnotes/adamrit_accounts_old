-- Referee - Viji tablet tile: append-only approval/comment log on referrals.
-- Each row is one review action ('approved' | 'rejected' | 'commented').
-- The "current status" of a visit is derived from the newest non-comment row.
-- Written statements / feedback images are stored in file_uploads with
-- category = 'referee_viji'.

create table if not exists public.referee_viji_reviews (
  id uuid primary key default gen_random_uuid(),
  visit_uuid uuid,                 -- visits.id (UUID)
  visit_id text,                   -- visits.visit_id (text)
  patient_name text,               -- denormalized for audit resilience
  action text not null check (action in ('approved', 'rejected', 'commented')),
  comment text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.referee_viji_reviews enable row level security;

-- Authenticated users can read all review rows.
drop policy if exists "referee_viji_reviews_select" on public.referee_viji_reviews;
create policy "referee_viji_reviews_select"
  on public.referee_viji_reviews for select
  to authenticated
  using (true);

-- Any authenticated user can add a review row (append-only — no update/delete).
drop policy if exists "referee_viji_reviews_insert" on public.referee_viji_reviews;
create policy "referee_viji_reviews_insert"
  on public.referee_viji_reviews for insert
  to authenticated
  with check (true);

create index if not exists referee_viji_reviews_visit_uuid_idx
  on public.referee_viji_reviews (visit_uuid);
create index if not exists referee_viji_reviews_created_at_idx
  on public.referee_viji_reviews (created_at desc);