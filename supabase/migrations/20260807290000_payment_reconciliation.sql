-- Payment reconciliation: what left the phones and the bank, against what the
-- books say was owed.
--
-- The problem this answers: the payment phones are handed around, PhonePe is
-- used by whoever holds one, and nothing tells the management that money went
-- out for something no bill was ever raised for. The rule is that a payment
-- may only be made against a bill that is in the system, so any debit that
-- cannot be tied to one is an exception to look at.
--
-- Three tables:
--   recon_sources       the phones and the bank accounts money leaves from
--   recon_uploads       one statement or screenshot batch, per source
--   recon_transactions  a line off that statement, and what it matched to
--
-- and match_recon_transactions(), which ties each debit to a payment already
-- posted in the books. What it cannot tie is left UNMATCHED — that list is the
-- alert.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — where money leaves from
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recon_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('UPI_PHONE', 'BANK_ACCOUNT')),
  -- The phone number for a handset, or the ledger for a bank account.
  phone_number TEXT,
  ledger_id    UUID REFERENCES public.chart_of_accounts(id),
  holder       TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recon_sources_label_uidx ON public.recon_sources (lower(btrim(label)));

CREATE TABLE IF NOT EXISTS public.recon_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    UUID NOT NULL REFERENCES public.recon_sources(id) ON DELETE CASCADE,
  period_start DATE,
  period_end   DATE,
  file_url     TEXT,
  file_path    TEXT,
  note         TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recon_uploads_source_idx ON public.recon_uploads (source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.recon_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id      UUID REFERENCES public.recon_uploads(id) ON DELETE SET NULL,
  source_id      UUID NOT NULL REFERENCES public.recon_sources(id) ON DELETE CASCADE,
  txn_date       DATE NOT NULL,
  txn_time       TEXT,
  direction      TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount         NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  counterparty   TEXT,
  reference      TEXT,
  raw_line       TEXT,
  status         TEXT NOT NULL DEFAULT 'UNMATCHED'
                 CHECK (status IN ('UNMATCHED', 'MATCHED', 'IGNORED')),
  matched_voucher_id UUID REFERENCES public.vouchers(id),
  match_note     TEXT,
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recon_txn_status_idx ON public.recon_transactions (status, txn_date DESC);
CREATE INDEX IF NOT EXISTS recon_txn_source_idx ON public.recon_transactions (source_id, txn_date DESC);

-- The same screenshot uploaded twice must not double the exceptions. A UPI
-- reference is unique where it exists; otherwise the phone, date, amount and
-- payee together identify the line.
CREATE UNIQUE INDEX IF NOT EXISTS recon_txn_reference_uidx
  ON public.recon_transactions (source_id, reference)
  WHERE reference IS NOT NULL AND btrim(reference) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS recon_txn_natural_uidx
  ON public.recon_transactions (source_id, txn_date, amount, COALESCE(lower(btrim(counterparty)), ''))
  WHERE reference IS NULL OR btrim(reference) = '';

ALTER TABLE public.recon_sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recon_sources') THEN
    CREATE POLICY recon_sources_all ON public.recon_sources FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recon_uploads') THEN
    CREATE POLICY recon_uploads_all ON public.recon_uploads FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recon_transactions') THEN
    CREATE POLICY recon_txn_all ON public.recon_transactions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 2 — the three phones, ready to be renamed on the tile
-- ---------------------------------------------------------------------------
INSERT INTO public.recon_sources (label, kind, holder)
SELECT v.label, 'UPI_PHONE', v.holder
  FROM (VALUES
    ('Phone 1', 'Handed around — set the holder on the tile'),
    ('Phone 2', 'Handed around — set the holder on the tile'),
    ('Phone 3', 'Handed around — set the holder on the tile')
  ) AS v(label, holder)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.recon_sources s WHERE lower(btrim(s.label)) = lower(v.label)
 );

-- ---------------------------------------------------------------------------
-- STEP 3 — tie each debit to a payment the books already carry
--
-- A payment voucher is the evidence that a bill was behind the money: expense
-- bills, GRN vendor bills and the daily allocation all post one. Match on the
-- amount and a few days either side, because a UPI debit and its voucher are
-- rarely stamped the same minute — the tightest match wins, and anything with
-- no candidate stays UNMATCHED, which is the alert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_recon_transactions(
  p_upload_id UUID DEFAULT NULL,
  p_days      INTEGER DEFAULT 3
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  r RECORD;
  v_voucher RECORD;
  v_matched INTEGER := 0;
  v_unmatched INTEGER := 0;
  v_value NUMERIC := 0;
BEGIN
  FOR r IN
    SELECT t.* FROM public.recon_transactions t
     WHERE t.status = 'UNMATCHED'
       AND t.direction = 'DEBIT'
       AND (p_upload_id IS NULL OR t.upload_id = p_upload_id)
  LOOP
    SELECT v.id, v.voucher_number, v.voucher_date, v.narration
      INTO v_voucher
      FROM public.vouchers v
      JOIN public.voucher_types vt ON vt.id = v.voucher_type_id
     WHERE v.status = 'AUTHORISED'
       AND COALESCE(v.is_optional, false) = false
       AND vt.voucher_category = 'PAYMENT'
       AND ROUND(v.total_amount, 2) = ROUND(r.amount, 2)
       AND v.voucher_date BETWEEN r.txn_date - p_days AND r.txn_date + p_days
       -- Not already claimed by another statement line.
       AND NOT EXISTS (
         SELECT 1 FROM public.recon_transactions x
          WHERE x.matched_voucher_id = v.id AND x.id <> r.id
       )
     ORDER BY ABS(v.voucher_date - r.txn_date), v.voucher_date DESC
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.recon_transactions
         SET status = 'MATCHED',
             matched_voucher_id = v_voucher.id,
             match_note = 'Matched to ' || v_voucher.voucher_number
                          || ' dated ' || to_char(v_voucher.voucher_date, 'DD-Mon-YY')
       WHERE id = r.id;
      v_matched := v_matched + 1;
    ELSE
      v_unmatched := v_unmatched + 1;
      v_value := v_value + r.amount;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'matched', v_matched,
    'unmatched', v_unmatched,
    'unmatched_value', ROUND(v_value, 2)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_recon_transactions(UUID, INTEGER) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- STEP 4 — the alert list, and what the books hold that no statement shows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_recon_alerts AS
SELECT t.id,
       t.txn_date,
       t.txn_time,
       t.amount,
       t.counterparty,
       t.reference,
       t.raw_line,
       s.label      AS source_label,
       s.kind       AS source_kind,
       s.holder     AS source_holder,
       CURRENT_DATE - t.txn_date AS days_old
  FROM public.recon_transactions t
  JOIN public.recon_sources s ON s.id = t.source_id
 WHERE t.status = 'UNMATCHED' AND t.direction = 'DEBIT'
 ORDER BY t.txn_date DESC, t.amount DESC;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- STEP 5 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_sources INTEGER; v_missing TEXT := '';
BEGIN
  SELECT COUNT(*) INTO v_sources FROM public.recon_sources WHERE kind = 'UPI_PHONE';
  IF v_sources < 3 THEN
    v_missing := v_missing || ' only ' || v_sources || ' phones seeded;';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'match_recon_transactions'
  ) THEN
    v_missing := v_missing || ' matcher missing;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.views
                  WHERE table_schema = 'public' AND table_name = 'v_recon_alerts') THEN
    v_missing := v_missing || ' alert view missing;';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT —%', v_missing;
  END IF;
  RAISE NOTICE 'OK — statements can be uploaded, matched, and what does not match is the alert';
END $$;
