-- Permissions, one table at a time. This is the first.
--
-- 237 tables carry a policy that lets anybody in, and the key that satisfies it
-- ships inside the public JavaScript bundle. Tightening them wholesale is how a
-- hospital loses access to its own records mid-shift, so they go one at a time,
-- least risky first, each one verified from outside with the public key before
-- the next is touched.
--
-- WHY THIS TABLE FIRST. cashbook_handwritten_uploads holds three scanned
-- handwritten cashbook pages, their OCR text, the storage path and the email of
-- whoever uploaded them. Its policies are "broad read / insert / update" TO
-- public with a qual of true -- readable AND writable by anyone who opens the
-- site and reads the key out of devtools.
--
-- It is also provably safe to lock:
--   * no reference anywhere in src/, api/, scripts/ or the migrations
--   * no trigger and no database function mentions it
--   * the three rows are from 30-Jun and 03-Jul, six weeks stale
-- It is a feature whose screens are gone, leaving the data behind. Nothing
-- running today can break, which is exactly what a first step should be able to
-- claim.
--
-- The service role bypasses RLS, so server-side code is unaffected either way.
-- An authenticated policy is left in place so that if the upload screen returns,
-- a signed-in member of staff can use it without another migration.

DROP POLICY IF EXISTS "cashbook handwriting broad read"   ON public.cashbook_handwritten_uploads;
DROP POLICY IF EXISTS "cashbook handwriting broad insert" ON public.cashbook_handwritten_uploads;
DROP POLICY IF EXISTS "cashbook handwriting broad update" ON public.cashbook_handwritten_uploads;

ALTER TABLE public.cashbook_handwritten_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cashbook uploads: signed-in staff"
  ON public.cashbook_handwritten_uploads
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.cashbook_handwritten_uploads IS
  'Scanned handwritten cashbook pages. Signed-in staff only since 16-Aug-2026; '
  'was readable and writable by anyone holding the public anon key.';

DO $verify$
DECLARE v_open INT; v_auth INT; v_rows INT; v_rls BOOLEAN;
BEGIN
  -- No policy may reach anon or public any more.
  SELECT count(*) INTO v_open FROM pg_policies
   WHERE schemaname='public' AND tablename='cashbook_handwritten_uploads'
     AND (roles && ARRAY['public','anon']::name[]);
  IF v_open > 0 THEN
    RAISE EXCEPTION 'ABORT: % policy/policies still reach anon', v_open;
  END IF;

  -- But staff must still have one, or the data is unreachable by anybody
  -- except the service role and this becomes a deletion in all but name.
  SELECT count(*) INTO v_auth FROM pg_policies
   WHERE schemaname='public' AND tablename='cashbook_handwritten_uploads'
     AND 'authenticated' = ANY(roles);
  IF v_auth < 1 THEN
    RAISE EXCEPTION 'ABORT: no policy left for signed-in staff';
  END IF;

  -- RLS must actually be on, or the policies above are decoration.
  SELECT relrowsecurity INTO v_rls FROM pg_class
   WHERE oid = 'public.cashbook_handwritten_uploads'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'ABORT: RLS is not enabled, so the policies do nothing';
  END IF;

  -- And not a row may have moved. This changes who may read, never what is.
  SELECT count(*) INTO v_rows FROM public.cashbook_handwritten_uploads;
  IF v_rows <> 3 THEN
    RAISE EXCEPTION 'ABORT: % row(s) present, expected the 3 that were there', v_rows;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
