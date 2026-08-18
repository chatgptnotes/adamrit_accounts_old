-- Let the PhonePe settlement slips actually reach storage.
--
-- THE FAULT (found 18 Aug while tracing a different upload failure):
-- 20260818190000_phonepe_settlement_docs.sql created recon_settlement_docs and
-- granted table access, but never granted anything on storage.objects. The
-- uploads bucket does not allow writes bucket-wide — every feature that uses it
-- gets its own policy scoped to one top-level folder, and only three exist:
-- 'expense-bills', 'ledger-qr' and 'panel-payments'.
--
-- uploadSettlementDocs() in src/lib/recon/settlementDays.ts writes to
-- 'settlement-docs/<source>/<date>/...', which matches none of them, so every
-- attach has been refused by row-level security since the feature shipped. The
-- bucket being marked public did not help: public governs reading, not writing.
--
-- SCOPED TO THE ONE PREFIX, like its neighbours. A blanket policy on the
-- uploads bucket would hand every screen in the app write access to every other
-- feature's files, which is exactly what the per-folder pattern exists to stop.
--
-- DELETE IS INCLUDED because the upload path depends on it: when the metadata
-- row cannot be written, the code removes the object again rather than leave a
-- file no screen can reach. Without DELETE that cleanup fails silently and
-- orphans accumulate.

DROP POLICY IF EXISTS "settlement_docs_insert" ON storage.objects;
CREATE POLICY "settlement_docs_insert"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'settlement-docs'
  );

DROP POLICY IF EXISTS "settlement_docs_select" ON storage.objects;
CREATE POLICY "settlement_docs_select"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'settlement-docs'
  );

DROP POLICY IF EXISTS "settlement_docs_delete" ON storage.objects;
CREATE POLICY "settlement_docs_delete"
  ON storage.objects
  FOR DELETE
  TO anon, authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = 'settlement-docs'
  );

DO $verify$
DECLARE v_n INT;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename = 'objects'
     AND policyname IN ('settlement_docs_insert',
                        'settlement_docs_select',
                        'settlement_docs_delete');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'ABORT: expected 3 settlement-docs storage policies, found %', v_n;
  END IF;

  -- The bucket the policies name must exist, or they guard nothing.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'uploads') THEN
    RAISE EXCEPTION 'ABORT: the uploads bucket does not exist';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
