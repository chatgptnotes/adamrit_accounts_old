-- Optional payment QR image and free-form description for every ledger master.
-- The QR file itself is stored in the existing uploads bucket under ledger-qr/;
-- this table stores its public URL alongside the ledger.

BEGIN;

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS ledger_description TEXT,
  ADD COLUMN IF NOT EXISTS ledger_qr_code_url TEXT;

COMMENT ON COLUMN public.chart_of_accounts.ledger_description IS
  'Optional user-entered description or note for the ledger master.';

COMMENT ON COLUMN public.chart_of_accounts.ledger_qr_code_url IS
  'Public URL of the optional payment QR image stored in uploads/ledger-qr.';

-- Adamrit's custom user login commonly reaches storage as anon. Limit access
-- to the ledger-qr prefix rather than opening the whole uploads bucket.
DROP POLICY IF EXISTS "ledger_qr_insert" ON storage.objects;
CREATE POLICY "ledger_qr_insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[1] = 'ledger-qr');

DROP POLICY IF EXISTS "ledger_qr_select" ON storage.objects;
CREATE POLICY "ledger_qr_select"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = 'ledger-qr');

NOTIFY pgrst, 'reload schema';

COMMIT;
