-- Historical Tally import pipeline.
-- Native .1800 company folders are never read by Postgres. TallyPrime exports
-- are parsed by scripts/import-tally-history.js into these auditable staging
-- tables before the validated rows are promoted to the existing tally_* mirror.

BEGIN;

INSERT INTO public.tally_config (company_name, is_active, auto_sync_enabled, sync_interval_minutes)
SELECT 'Hope Hospital Partnership', false, false, 30
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tally_config
  WHERE regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') =
        'hopehospitalpartnership'
);

CREATE TABLE IF NOT EXISTS public.tally_history_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.tally_config(id),
  source_file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_format TEXT NOT NULL CHECK (source_format IN ('xml', 'json')),
  import_kind TEXT NOT NULL CHECK (import_kind IN ('masters', 'vouchers', 'report')),
  period_from DATE,
  period_to DATE,
  source_company_name TEXT,
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'validated', 'promoted', 'failed')),
  staged_records INTEGER NOT NULL DEFAULT 0 CHECK (staged_records >= 0),
  promoted_records INTEGER NOT NULL DEFAULT 0 CHECK (promoted_records >= 0),
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_details JSONB,
  staged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (company_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS public.tally_history_stage_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.tally_history_import_batches(id) ON DELETE CASCADE,
  master_type TEXT NOT NULL CHECK (master_type IN ('group', 'ledger', 'stock_item')),
  source_key TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_name TEXT,
  tally_guid TEXT,
  opening_balance NUMERIC(18,2),
  closing_balance NUMERIC(18,2),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, master_type, source_key)
);

CREATE TABLE IF NOT EXISTS public.tally_history_stage_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.tally_history_import_batches(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  tally_guid TEXT,
  voucher_number TEXT,
  voucher_type TEXT NOT NULL,
  voucher_date DATE NOT NULL,
  party_ledger TEXT,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  narration TEXT,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, source_fingerprint)
);

CREATE TABLE IF NOT EXISTS public.tally_history_stage_voucher_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staged_voucher_id UUID NOT NULL REFERENCES public.tally_history_stage_vouchers(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number >= 1),
  ledger_name TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  is_debit BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (staged_voucher_id, line_number)
);

CREATE TABLE IF NOT EXISTS public.tally_history_stage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.tally_history_import_batches(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('trial_balance', 'balance_sheet', 'pnl')),
  report_date DATE,
  period_from DATE,
  period_to DATE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, report_type, report_date, period_from, period_to)
);

ALTER TABLE public.tally_vouchers
  ADD COLUMN IF NOT EXISTS historical_import_batch_id UUID
    REFERENCES public.tally_history_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tally_vouchers_company_source_fingerprint_uidx
  ON public.tally_vouchers(company_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS tally_history_batches_company_status_idx
  ON public.tally_history_import_batches(company_id, status, staged_at DESC);
CREATE INDEX IF NOT EXISTS tally_history_stage_vouchers_batch_date_idx
  ON public.tally_history_stage_vouchers(batch_id, voucher_date);
CREATE INDEX IF NOT EXISTS tally_history_stage_vouchers_guid_idx
  ON public.tally_history_stage_vouchers(tally_guid)
  WHERE tally_guid IS NOT NULL;
CREATE INDEX IF NOT EXISTS tally_history_stage_lines_voucher_idx
  ON public.tally_history_stage_voucher_lines(staged_voucher_id, line_number);

ALTER TABLE public.tally_history_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_history_stage_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_history_stage_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_history_stage_voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tally_history_stage_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_tally_history_batches"
  ON public.tally_history_import_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_tally_history_masters"
  ON public.tally_history_stage_masters FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_tally_history_vouchers"
  ON public.tally_history_stage_vouchers FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_tally_history_voucher_lines"
  ON public.tally_history_stage_voucher_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_tally_history_reports"
  ON public.tally_history_stage_reports FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.validate_tally_history_import(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.tally_history_import_batches;
  v_voucher_count INTEGER := 0;
  v_unbalanced_count INTEGER := 0;
  v_bad_date_count INTEGER := 0;
  v_result JSONB;
BEGIN
  SELECT * INTO v_batch
  FROM public.tally_history_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown Tally history import batch %', p_batch_id; END IF;
  IF v_batch.status IN ('promoted', 'failed') THEN
    RAISE EXCEPTION 'Batch % cannot be validated while status is %', p_batch_id, v_batch.status;
  END IF;

  SELECT count(*) INTO v_voucher_count
  FROM public.tally_history_stage_vouchers WHERE batch_id = p_batch_id;

  SELECT count(*) INTO v_unbalanced_count
  FROM (
    SELECT v.id
    FROM public.tally_history_stage_vouchers v
    LEFT JOIN public.tally_history_stage_voucher_lines l ON l.staged_voucher_id = v.id
    WHERE v.batch_id = p_batch_id
    GROUP BY v.id
    HAVING count(l.id) < 2
       OR abs(coalesce(sum(CASE WHEN l.is_debit THEN l.amount ELSE -l.amount END), 0)) > 0.01
  ) invalid_vouchers;

  SELECT count(*) INTO v_bad_date_count
  FROM public.tally_history_stage_vouchers
  WHERE batch_id = p_batch_id
    AND ((v_batch.period_from IS NOT NULL AND voucher_date < v_batch.period_from)
      OR (v_batch.period_to IS NOT NULL AND voucher_date > v_batch.period_to));

  v_result := jsonb_build_object(
    'voucher_count', v_voucher_count,
    'unbalanced_voucher_count', v_unbalanced_count,
    'out_of_period_voucher_count', v_bad_date_count,
    'valid', v_unbalanced_count = 0 AND v_bad_date_count = 0
  );

  UPDATE public.tally_history_import_batches
  SET validation = v_result,
      status = CASE WHEN (v_result->>'valid')::boolean THEN 'validated' ELSE 'failed' END,
      validated_at = now()
  WHERE id = p_batch_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_tally_history_import(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.tally_history_import_batches;
  v_promoted INTEGER := 0;
BEGIN
  SELECT * INTO v_batch
  FROM public.tally_history_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown Tally history import batch %', p_batch_id; END IF;
  IF v_batch.status <> 'validated' THEN
    RAISE EXCEPTION 'Batch % must be validated before promotion (current status: %)', p_batch_id, v_batch.status;
  END IF;

  INSERT INTO public.tally_groups (company_id, name, parent_group, nature_of_group, raw_data, last_synced_at)
  SELECT v_batch.company_id, m.name, m.parent_name, m.details->>'nature_of_group', m.raw_data, now()
  FROM public.tally_history_stage_masters m
  WHERE m.batch_id = p_batch_id AND m.master_type = 'group'
  ON CONFLICT (company_id, name) DO UPDATE
  SET parent_group = EXCLUDED.parent_group,
      nature_of_group = EXCLUDED.nature_of_group,
      raw_data = EXCLUDED.raw_data,
      last_synced_at = EXCLUDED.last_synced_at;

  INSERT INTO public.tally_ledgers (
    company_id, name, tally_guid, parent_group, opening_balance, closing_balance,
    raw_data, last_synced_at
  )
  SELECT v_batch.company_id, m.name, m.tally_guid, m.parent_name,
         m.opening_balance, m.closing_balance, m.raw_data, now()
  FROM public.tally_history_stage_masters m
  WHERE m.batch_id = p_batch_id AND m.master_type = 'ledger'
  ON CONFLICT (company_id, name) DO UPDATE
  SET tally_guid = COALESCE(EXCLUDED.tally_guid, public.tally_ledgers.tally_guid),
      parent_group = EXCLUDED.parent_group,
      opening_balance = EXCLUDED.opening_balance,
      closing_balance = COALESCE(EXCLUDED.closing_balance, public.tally_ledgers.closing_balance),
      raw_data = EXCLUDED.raw_data,
      last_synced_at = EXCLUDED.last_synced_at;

  INSERT INTO public.tally_stock_items (
    company_id, name, tally_guid, stock_group, unit, opening_balance, closing_balance,
    opening_value, closing_value, rate, gst_rate, hsn_code, raw_data, last_synced_at
  )
  SELECT v_batch.company_id, m.name, m.tally_guid, m.parent_name,
         m.details->>'unit', m.opening_balance, m.closing_balance,
         NULLIF(m.details->>'opening_value', '')::numeric,
         NULLIF(m.details->>'closing_value', '')::numeric,
         NULLIF(m.details->>'rate', '')::numeric,
         NULLIF(m.details->>'gst_rate', '')::numeric,
         m.details->>'hsn_code', m.raw_data, now()
  FROM public.tally_history_stage_masters m
  WHERE m.batch_id = p_batch_id AND m.master_type = 'stock_item'
  ON CONFLICT (company_id, name) DO UPDATE
  SET tally_guid = COALESCE(EXCLUDED.tally_guid, public.tally_stock_items.tally_guid),
      stock_group = EXCLUDED.stock_group,
      unit = EXCLUDED.unit,
      opening_balance = EXCLUDED.opening_balance,
      closing_balance = COALESCE(EXCLUDED.closing_balance, public.tally_stock_items.closing_balance),
      opening_value = COALESCE(EXCLUDED.opening_value, public.tally_stock_items.opening_value),
      closing_value = COALESCE(EXCLUDED.closing_value, public.tally_stock_items.closing_value),
      rate = COALESCE(EXCLUDED.rate, public.tally_stock_items.rate),
      gst_rate = COALESCE(EXCLUDED.gst_rate, public.tally_stock_items.gst_rate),
      hsn_code = COALESCE(EXCLUDED.hsn_code, public.tally_stock_items.hsn_code),
      raw_data = EXCLUDED.raw_data,
      last_synced_at = EXCLUDED.last_synced_at;

  UPDATE public.tally_vouchers t
  SET tally_guid = COALESCE(s.tally_guid, t.tally_guid),
      voucher_number = s.voucher_number,
      voucher_type = s.voucher_type,
      date = s.voucher_date,
      party_ledger = s.party_ledger,
      amount = s.amount,
      narration = s.narration,
      is_cancelled = s.is_cancelled,
      ledger_entries = l.lines,
      raw_data = s.raw_data,
      sync_direction = 'from_tally_history',
      sync_status = 'synced',
      synced_at = now(),
      historical_import_batch_id = p_batch_id,
      source_fingerprint = s.source_fingerprint
  FROM public.tally_history_stage_vouchers s
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('ledger', x.ledger_name, 'amount', abs(x.amount), 'is_debit', x.is_debit) ORDER BY x.line_number) AS lines
    FROM public.tally_history_stage_voucher_lines x WHERE x.staged_voucher_id = s.id
  ) l
  WHERE s.batch_id = p_batch_id
    AND t.company_id = v_batch.company_id
    AND (t.source_fingerprint = s.source_fingerprint
      OR (s.tally_guid IS NOT NULL AND s.tally_guid <> '' AND t.tally_guid = s.tally_guid));

  INSERT INTO public.tally_vouchers (
    company_id, tally_guid, voucher_number, voucher_type, date, party_ledger, amount,
    narration, is_cancelled, ledger_entries, raw_data, sync_direction, sync_status,
    synced_at, historical_import_batch_id, source_fingerprint
  )
  SELECT v_batch.company_id, s.tally_guid, s.voucher_number, s.voucher_type, s.voucher_date,
         s.party_ledger, s.amount, s.narration, s.is_cancelled, l.lines, s.raw_data,
         'from_tally_history', 'synced', now(), p_batch_id, s.source_fingerprint
  FROM public.tally_history_stage_vouchers s
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('ledger', x.ledger_name, 'amount', abs(x.amount), 'is_debit', x.is_debit) ORDER BY x.line_number) AS lines
    FROM public.tally_history_stage_voucher_lines x WHERE x.staged_voucher_id = s.id
  ) l
  WHERE s.batch_id = p_batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.tally_vouchers t
      WHERE t.company_id = v_batch.company_id
        AND (t.source_fingerprint = s.source_fingerprint
          OR (s.tally_guid IS NOT NULL AND s.tally_guid <> '' AND t.tally_guid = s.tally_guid))
    );
  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  INSERT INTO public.tally_reports (company_id, report_type, report_date, period_from, period_to, data, fetched_at)
  SELECT v_batch.company_id, r.report_type, r.report_date, r.period_from, r.period_to,
         r.data || jsonb_build_object('history_import_batch_id', p_batch_id), now()
  FROM public.tally_history_stage_reports r
  WHERE r.batch_id = p_batch_id;

  UPDATE public.tally_history_import_batches
  SET status = 'promoted', promoted_records = v_promoted, promoted_at = now()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'inserted_vouchers', v_promoted, 'status', 'promoted');
END;
$$;

REVOKE ALL ON FUNCTION public.validate_tally_history_import(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_tally_history_import(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_tally_history_import(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_tally_history_import(UUID) TO service_role;

COMMIT;
