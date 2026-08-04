-- "Shashank Payment Received" — corporate / panel / Yojana money as it lands.
--
-- When a portal pays out for an IPD patient, the amount received is recorded
-- against that patient the day it arrives, with a screenshot of the portal's
-- payment details as evidence. One row per payment received; a claim paid in
-- parts gets a row per part.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.panel_payment_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The visit's printed code (IH25F27004), the key billing tables share.
  visit_id        TEXT,
  patient_name    TEXT NOT NULL,
  corporate       TEXT,
  hospital_name   TEXT,
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  received_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  reference       TEXT,
  notes           TEXT,
  -- Screenshot of the payment details from the portal.
  screenshot_path TEXT,
  screenshot_url  TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.panel_payment_receipts IS
  'Payments received from corporate/panel/Yojana portals for IPD patients, recorded as they arrive (Shashank Payment Received tile).';

CREATE INDEX IF NOT EXISTS idx_panel_payment_receipts_visit
  ON public.panel_payment_receipts(visit_id);
CREATE INDEX IF NOT EXISTS idx_panel_payment_receipts_date
  ON public.panel_payment_receipts(received_date DESC);

ALTER TABLE public.panel_payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panel_payment_receipts_read" ON public.panel_payment_receipts;
CREATE POLICY "panel_payment_receipts_read"
  ON public.panel_payment_receipts FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "panel_payment_receipts_insert" ON public.panel_payment_receipts;
CREATE POLICY "panel_payment_receipts_insert"
  ON public.panel_payment_receipts FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.panel_payment_receipts TO anon, authenticated;

-- Portal screenshots live under their own prefix in the uploads bucket.
DROP POLICY IF EXISTS "panel_payment_screenshot_insert" ON storage.objects;
CREATE POLICY "panel_payment_screenshot_insert"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'uploads' AND (storage.foldername(name))[1] = 'panel-payments');

DROP POLICY IF EXISTS "panel_payment_screenshot_select" ON storage.objects;
CREATE POLICY "panel_payment_screenshot_select"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = 'panel-payments');

NOTIFY pgrst, 'reload schema';

COMMIT;
