-- Which tablet tiles belong to which staff.
--
-- The tablet home grid is a static list (src/tablet/config/modules.ts) shown in
-- declaration order to everyone, so a nurse and an accountant scroll the same
-- 38 tiles to reach the two or three they actually use. This table records the
-- work each person is here to do, and the tablet floats those tiles into a
-- "Your Work" band above the rest.
--
-- It only promotes; it never hides. A tile nobody is mapped to still appears
-- for everyone further down the grid, so filling this table in wrongly can slow
-- someone down but can never lock them out of a screen they had yesterday.
--
-- A row points at exactly one target - either a person or a role - never both
-- and never neither:
--   user_id set  -> that one employee, whatever role they hold
--   role set     -> everyone currently carrying that role string
-- Roles are the broad strokes (every nurse gets the medication round), and a
-- user row is the exception on top (this one nurse also runs dialysis). The two
-- are additive, so an employee sees the union of both.
--
-- The tile_id is the module id from src/tablet/config/modules.ts, e.g.
-- 'medication-round'. It is deliberately not a foreign key: the tile list lives
-- in the app, not the database. An id left behind by a renamed module simply
-- matches nothing and is ignored by the tablet, and the configuration master
-- lists it as unknown so it can be cleared.

CREATE TABLE IF NOT EXISTS public.tile_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tile_id     TEXT NOT NULL,
  user_id     UUID REFERENCES public."User"(id) ON DELETE CASCADE,
  role        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  CONSTRAINT tile_assignments_one_target CHECK ((user_id IS NULL) <> (role IS NULL))
);

COMMENT ON TABLE public.tile_assignments IS
  'Maps a tablet tile id to a staff member or a role. Matching tiles are '
  'promoted to the top of that person''s tablet home grid. Promotion only - '
  'unmapped tiles stay visible to everyone below.';

-- One row per tile per target, so assigning twice is a no-op rather than a
-- duplicate that would have to be de-duplicated on read. Partial indexes
-- because a NULL user_id must not collide with another NULL user_id.
CREATE UNIQUE INDEX IF NOT EXISTS tile_assignments_tile_user_uniq
  ON public.tile_assignments (tile_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tile_assignments_tile_role_uniq
  ON public.tile_assignments (tile_id, role) WHERE role IS NOT NULL;

-- The tablet's only read is "everything for this user id or this role", once
-- per home-screen load.
CREATE INDEX IF NOT EXISTS tile_assignments_user_idx
  ON public.tile_assignments (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tile_assignments_role_idx
  ON public.tile_assignments (role) WHERE role IS NOT NULL;

ALTER TABLE public.tile_assignments ENABLE ROW LEVEL SECURITY;

-- Same posture as hospital_stamps and doctor_credentials: the app authenticates
-- at the application layer and talks to Supabase with the anon key, so the
-- policy is permissive here and who may edit the mapping is enforced in the UI
-- (the Tile Configuration master is admin-only).
DROP POLICY IF EXISTS tile_assignments_all ON public.tile_assignments;
CREATE POLICY tile_assignments_all ON public.tile_assignments
  FOR ALL USING (true) WITH CHECK (true);

SELECT COUNT(*) AS assignments_on_file FROM public.tile_assignments;
