-- Tile access rules move out of the browser and into the database.
--
-- WHY
-- The tile x role matrix in User Management wrote to localStorage under the key
-- "tileAccessOverrides". That meant an administrator setting "only accountants
-- see the Accounting sidebar item" changed nothing for the accountants, nothing
-- for anyone else, and nothing on their own second device -- it changed one
-- browser profile. The screen read as access control and was not; it carried a
-- banner admitting so. Ten screens consume these rules (the sidebar,
-- Index, Accounting, Director/Marketing dashboards, Today's OPD, Location
-- Master, Dialysis), so the setting looked consequential.
--
-- A row here IS an override. No row means the default compiled into
-- src/config/tileAccess.ts stands. That distinction has to survive the move:
-- the old map treated "key present with value undefined" as a deliberate
-- "everyone sees this", overriding a restrictive default, and roles IS NULL
-- carries the same meaning here.
--
-- WRITES DO NOT COME FROM THE BROWSER. There is deliberately no INSERT/UPDATE/
-- DELETE policy: the anon key is published in the JS bundle, so a write policy
-- satisfied by it would let a stranger with devtools decide who sees which
-- screen. Changes go through /api/tile-access, which runs withRoute({auth:
-- 'admin'}) -- the caller's superadmin role re-read from the database on every
-- request -- and writes with the service role.

CREATE TABLE IF NOT EXISTS public.tile_access_overrides (
  tile_id    text PRIMARY KEY,
  roles      text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

COMMENT ON TABLE public.tile_access_overrides IS
  'Per-tile role visibility, edited in User Management -> Tile Access Control. A row overrides the default in src/config/tileAccess.ts; no row means the default stands. Written only by /api/tile-access (service role); readable by everyone.';

COMMENT ON COLUMN public.tile_access_overrides.roles IS
  'NULL = every role sees this tile. Empty array = nobody sees it. Otherwise exactly these roles. Matches the three-way meaning canSeeTile() has always had.';

COMMENT ON COLUMN public.tile_access_overrides.updated_by IS
  'Email of the administrator who last set this row, from the API session. Who narrowed a screen is worth keeping.';

ALTER TABLE public.tile_access_overrides ENABLE ROW LEVEL SECURITY;

-- Read is open, and must stay open. Every page asks this question during its
-- first render for every signed-in person, and a read that fails or is refused
-- would hide tiles from staff who are entitled to them. The contents are a list
-- of role names against tile ids -- no patient data, nothing personal.
DROP POLICY IF EXISTS tile_access_overrides_read ON public.tile_access_overrides;
CREATE POLICY tile_access_overrides_read ON public.tile_access_overrides
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- Self-verification. Scoped to this one table: a global assertion about RLS
-- would abort here for the many service-role-only tables that are deliberately
-- policy-free.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_on    boolean;
  v_selects   int;
  v_writes    int;
BEGIN
  SELECT c.relrowsecurity INTO v_rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'tile_access_overrides';

  IF v_rls_on IS NULL THEN
    RAISE EXCEPTION 'tile_access_overrides was not created';
  END IF;

  IF NOT v_rls_on THEN
    RAISE EXCEPTION 'RLS is not enabled on tile_access_overrides';
  END IF;

  SELECT count(*) INTO v_selects
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'tile_access_overrides'
     AND cmd = 'SELECT';

  IF v_selects < 1 THEN
    RAISE EXCEPTION 'no SELECT policy on tile_access_overrides -- staff would lose tiles';
  END IF;

  -- The whole point of routing writes through the API: nothing the published
  -- anon key holds may change who sees which screen.
  SELECT count(*) INTO v_writes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'tile_access_overrides'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  IF v_writes > 0 THEN
    RAISE EXCEPTION 'tile_access_overrides has % write polic(ies); writes must stay service-role only', v_writes;
  END IF;

  RAISE NOTICE 'tile_access_overrides OK: RLS on, % SELECT policy, no write policy', v_selects;
END $$;

SELECT count(*) AS overrides_on_file FROM public.tile_access_overrides;
