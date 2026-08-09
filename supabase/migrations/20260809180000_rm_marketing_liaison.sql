-- Which marketing user liaisons each relationship manager.
--
-- Every RM is handled by one of the marketing-role users. The Daily Revenue
-- Report shows a patient's RM and the cut or spot owed to them, but not who
-- on the marketing side is answerable for that RM, so a query about a cut has
-- no name attached to it.
--
-- The liaison is read on a report the whole office opens, so it is served
-- through a narrow view rather than by reading the User table directly: the
-- lockdown migration for "User" is written and will land, and a report must
-- not break when it does. The view exposes an id and a display name and
-- nothing else — no email, no role, no password column within reach.
--
-- Safe to run twice. Applied through apply_migration(), which supplies the
-- transaction, so this file carries no BEGIN/COMMIT of its own.

ALTER TABLE public.relationship_managers
  ADD COLUMN IF NOT EXISTS liaison_user_id UUID REFERENCES public."User"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_relationship_managers_liaison
  ON public.relationship_managers (liaison_user_id);

-- Marketing users, id and name only. A plain view runs with its owner's
-- rights, so it keeps working once "User" itself is closed to the anon role.
CREATE OR REPLACE VIEW public.v_marketing_liaisons AS
SELECT u.id,
       COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1)) AS name
  FROM public."User" u
 WHERE lower(COALESCE(u.role, '')) LIKE '%marketing%'
   AND COALESCE(u.is_active, true);

REVOKE ALL ON public.v_marketing_liaisons FROM PUBLIC;
GRANT SELECT ON public.v_marketing_liaisons TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_cols INT;
  v_rows INT;
BEGIN
  -- The view must expose exactly two columns — nothing from "User" leaks by
  -- someone later adding a column to it.
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'v_marketing_liaisons';
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'v_marketing_liaisons should expose 2 columns, found %', v_cols;
  END IF;

  SELECT count(*) INTO v_rows FROM public.v_marketing_liaisons;
  RAISE NOTICE 'OK — % marketing liaison(s) visible, RM master carries liaison_user_id', v_rows;
END;
$verify$;
