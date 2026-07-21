-- Referee - Ruby tablet tile: append-only feedback on how a patient came to
-- know about the hospital, attached to a visit. Written statements / feedback
-- images are stored in file_uploads with category = 'referee_feedback'.

create table if not exists public.referee_feedback (
  id uuid primary key default gen_random_uuid(),
  visit_uuid uuid,                 -- visits.id (UUID) — nullable for legacy rows
  visit_id text,                   -- visits.visit_id (text) — human-readable code
  patient_name text,               -- denormalized for audit resilience
  how_they_knew text,              -- the feedback comment
  created_by text,
  created_at timestamptz not null default now()
);

-- Append-only: no update/delete for app roles. (RLS policies below allow
-- SELECT/INSERT only.)
alter table public.referee_feedback enable row level security;

-- Authenticated users can read all referee feedback rows.
drop policy if exists "referee_feedback_select" on public.referee_feedback;
create policy "referee_feedback_select"
  on public.referee_feedback for select
  to authenticated
  using (true);

-- Any authenticated user can add a feedback row (append-only — no update/delete).
drop policy if exists "referee_feedback_insert" on public.referee_feedback;
create policy "referee_feedback_insert"
  on public.referee_feedback for insert
  to authenticated
  with check (true);

-- Helpful index for the per-visit lookup used by the tablet tile.
create index if not exists referee_feedback_visit_uuid_idx
  on public.referee_feedback (visit_uuid);
create index if not exists referee_feedback_created_at_idx
  on public.referee_feedback (created_at desc);