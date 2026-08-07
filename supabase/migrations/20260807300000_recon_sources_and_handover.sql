-- Name the phones after who carries them, and record the daily handover.
--
-- Nisha, Azhar and Akshay carry the payment phones and hand them back each
-- evening; the rule is that the day's PhonePe history is uploaded before the
-- handover. So the phones are named for them, and a view answers the only
-- question that matters at handover time: has today's history been uploaded
-- for this phone yet.
--
-- Bank accounts money actually leaves from are seeded too, so a monthly
-- statement has somewhere to go.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — the phones, by holder
-- ---------------------------------------------------------------------------
UPDATE public.recon_sources SET label = 'Nisha''s phone', holder = 'Nisha'
 WHERE lower(btrim(label)) = 'phone 1';
UPDATE public.recon_sources SET label = 'Azhar''s phone', holder = 'Azhar'
 WHERE lower(btrim(label)) = 'phone 2';
UPDATE public.recon_sources SET label = 'Akshay''s phone', holder = 'Akshay'
 WHERE lower(btrim(label)) = 'phone 3';

-- ---------------------------------------------------------------------------
-- STEP 2 — the bank accounts a monthly statement can be reconciled against
-- ---------------------------------------------------------------------------
INSERT INTO public.recon_sources (label, kind, ledger_id, holder)
SELECT DISTINCT ON (lower(btrim(a.account_name)))
       a.account_name, 'BANK_ACCOUNT', a.id, c.company_name
  FROM public.chart_of_accounts a
  JOIN public.companies c ON c.id = a.company_id
 WHERE a.is_active
   AND a.account_group IN ('Bank Accounts', 'BANK')
   AND c.is_active
   AND NOT EXISTS (
     SELECT 1 FROM public.recon_sources s
      WHERE lower(btrim(s.label)) = lower(btrim(a.account_name))
   )
 ORDER BY lower(btrim(a.account_name)), c.company_name;

-- ---------------------------------------------------------------------------
-- STEP 3 — has today's history been handed in?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_recon_handover_today AS
SELECT s.id            AS source_id,
       s.label,
       s.holder,
       s.kind,
       u.id            AS upload_id,
       u.created_at    AS uploaded_at,
       u.uploaded_by,
       (u.id IS NOT NULL) AS handed_in
  FROM public.recon_sources s
  LEFT JOIN LATERAL (
    SELECT x.id, x.created_at, x.uploaded_by
      FROM public.recon_uploads x
     WHERE x.source_id = s.id
       AND x.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
     ORDER BY x.created_at DESC
     LIMIT 1
  ) u ON true
 WHERE s.is_active AND s.kind = 'UPI_PHONE'
 ORDER BY s.label;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_phones INTEGER; v_banks INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_phones FROM public.recon_sources WHERE kind = 'UPI_PHONE' AND is_active;
  SELECT COUNT(*) INTO v_banks  FROM public.recon_sources WHERE kind = 'BANK_ACCOUNT' AND is_active;
  IF v_phones < 3 THEN RAISE EXCEPTION 'ABORT: % phones, expected 3', v_phones; END IF;
  IF v_banks < 1 THEN RAISE EXCEPTION 'ABORT: no bank accounts seeded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.views
                  WHERE table_schema='public' AND table_name='v_recon_handover_today') THEN
    RAISE EXCEPTION 'ABORT: handover view missing';
  END IF;
  RAISE NOTICE 'OK — % phones and % bank accounts ready to reconcile', v_phones, v_banks;
END $$;
