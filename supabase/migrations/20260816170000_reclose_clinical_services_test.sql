-- Re-close visit_clinical_services. One table, as a controlled test.
--
-- The identity chain is now proven end to end, each link tested rather than
-- assumed:
--
--   server mints a token   /api/auth-session returns a dbToken
--   the token is sound     role=authenticated, aud=authenticated, correct ref
--   the database accepts   that token read a locked table over REST
--   the browser attaches   Stores & Inventory loaded inventory_items, which is
--                          authenticated-only and was never reopened
--
-- The last one is the point. It could not be established from outside, and
-- guessing at it is what produced two wrong diagnoses and an hour of exposed
-- clinical data earlier today.
--
-- WHY THIS SHOULD NOW WORK. The SELECT and INSERT policies on this table test
-- the same expression, auth.role() = 'authenticated'. Reads pass with the
-- browser's token, so writes will: same session, same role, same predicate.
--
-- Deliberately one table. If the ECG charge saves, the remaining eighteen
-- follow in one migration. If it does not, only billing is affected and the
-- reversal is a single statement already written below in the comment.
--
-- Reversal:
--   CREATE POLICY "app access pending identity"
--     ON public.visit_clinical_services FOR ALL TO public
--     USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app access pending identity" ON public.visit_clinical_services;

COMMENT ON TABLE public.visit_clinical_services IS
  'Signed-in staff only. The anon-key policy added on 16-Aug-2026 was removed '
  'once the browser was confirmed to present a database token.';

DO $verify$
DECLARE v_open INT; v_auth INT; v_rls BOOLEAN;
BEGIN
  -- Nothing may reach it with the public key any more.
  SELECT count(*) INTO v_open FROM pg_policies
   WHERE schemaname='public' AND tablename='visit_clinical_services'
     AND COALESCE(qual,'true')='true' AND COALESCE(with_check,'true')='true'
     AND (roles && ARRAY['public','anon']::name[]);
  IF v_open > 0 THEN
    RAISE EXCEPTION 'ABORT: still open to the anon key';
  END IF;

  -- But signed-in staff must keep a way in for BOTH reading and writing. A
  -- select-only policy set would close billing rather than secure it, which is
  -- the exact failure this test exists to detect early.
  SELECT count(*) INTO v_auth FROM pg_policies
   WHERE schemaname='public' AND tablename='visit_clinical_services'
     AND (cmd IN ('INSERT','ALL'))
     AND (qual ILIKE '%authenticated%' OR with_check ILIKE '%authenticated%'
          OR 'authenticated' = ANY(roles));
  IF v_auth < 1 THEN
    RAISE EXCEPTION 'ABORT: no INSERT path left for signed-in staff';
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class
   WHERE oid='public.visit_clinical_services'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'ABORT: RLS is off, so none of this applies';
  END IF;

  -- The other eighteen stay open until this test passes. Re-closing them in the
  -- same breath would make a failure indistinguishable from the last two.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='discharge_summaries'
       AND policyname='app access pending identity'
  ) THEN
    RAISE EXCEPTION 'ABORT: the other tables were closed too; this is meant to be one table';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
