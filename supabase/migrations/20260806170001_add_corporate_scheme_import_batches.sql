-- Latest-upload dashboard support for the isolated Corporate Scheme Framework.
-- This migration does not alter PMJAY/MJPJAY or core HMIS patient/visit tables.

CREATE TABLE IF NOT EXISTS public.corporate_scheme_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_code TEXT NOT NULL REFERENCES public.corporate_schemes(scheme_code) ON DELETE RESTRICT,
  source_file_name TEXT,
  imported_by TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.corporate_scheme_records
  ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES public.corporate_scheme_imports(id) ON DELETE RESTRICT;

-- Preserve records imported before batch tracking by assigning each scheme one active legacy batch.
INSERT INTO public.corporate_scheme_imports (scheme_code, source_file_name, status, is_active, completed_at)
SELECT scheme_code, 'Existing corporate scheme data', 'completed', true, now()
FROM public.corporate_schemes
ON CONFLICT DO NOTHING;

UPDATE public.corporate_scheme_records AS record
SET import_id = import_batch.id
FROM public.corporate_scheme_imports AS import_batch
WHERE record.import_id IS NULL
  AND import_batch.scheme_code = record.scheme_code
  AND import_batch.source_file_name = 'Existing corporate scheme data';

-- Keep the existing (scheme_code, record_key) uniqueness rule. This preserves
-- compatibility with an already-open older frontend during rollout; the latest
-- import is selected using import_id instead of changing the existing key.
CREATE OR REPLACE FUNCTION public.assign_active_corporate_scheme_import()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.import_id IS NULL THEN
    SELECT id INTO NEW.import_id
    FROM public.corporate_scheme_imports
    WHERE scheme_code = NEW.scheme_code AND is_active
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_active_corporate_scheme_import ON public.corporate_scheme_records;
CREATE TRIGGER trg_assign_active_corporate_scheme_import
  BEFORE INSERT ON public.corporate_scheme_records
  FOR EACH ROW EXECUTE FUNCTION public.assign_active_corporate_scheme_import();

ALTER TABLE public.corporate_scheme_records
  ALTER COLUMN import_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_corporate_scheme_imports_one_active_scheme
  ON public.corporate_scheme_imports(scheme_code) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_corporate_scheme_records_import_status
  ON public.corporate_scheme_records(import_id, status);

ALTER TABLE public.corporate_scheme_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corporate_scheme_imports_hmis_client_all"
  ON public.corporate_scheme_imports FOR ALL
  TO public USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.activate_corporate_scheme_import(p_import_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  target_scheme_code TEXT;
BEGIN
  SELECT scheme_code INTO target_scheme_code
  FROM public.corporate_scheme_imports
  WHERE id = p_import_id AND status = 'processing';

  IF target_scheme_code IS NULL THEN
    RAISE EXCEPTION 'Corporate scheme import batch is not ready to activate';
  END IF;

  UPDATE public.corporate_scheme_imports
  SET is_active = false
  WHERE scheme_code = target_scheme_code AND is_active;

  UPDATE public.corporate_scheme_imports
  SET status = 'completed', is_active = true, completed_at = now()
  WHERE id = p_import_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_corporate_scheme_dashboard_summary(p_scheme_code TEXT)
RETURNS TABLE (
  total_patients BIGINT,
  admitted_patients BIGINT,
  discharged_patients BIGINT,
  claim_query_patients BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH active_records AS (
    SELECT
      lower(regexp_replace(trim(record.status), '\\s+', ' ', 'g')) AS normalized_status,
      lower(regexp_replace(trim(record.status), '\\s+', ' ', 'g')) ~ '(claim[[:space:]-]*quer|quer[[:space:]-]*claim)'
        AND lower(regexp_replace(trim(record.status), '\\s+', ' ', 'g')) !~ '(resolv|clos|complete)' AS has_active_claim_query
    FROM public.corporate_scheme_records AS record
    INNER JOIN public.corporate_scheme_imports AS import_batch ON import_batch.id = record.import_id
    WHERE import_batch.scheme_code = upper(trim(p_scheme_code))
      AND import_batch.is_active
      AND import_batch.status = 'completed'
  )
  SELECT
    count(*)::BIGINT AS total_patients,
    count(*) FILTER (WHERE has_active_claim_query)::BIGINT AS claim_query_patients,
    count(*) FILTER (WHERE normalized_status ~ 'admit' AND NOT has_active_claim_query)::BIGINT AS admitted_patients,
    count(*) FILTER (WHERE normalized_status ~ 'discharg' AND NOT has_active_claim_query)::BIGINT AS discharged_patients
  FROM active_records;
$$;

GRANT EXECUTE ON FUNCTION public.activate_corporate_scheme_import(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_corporate_scheme_dashboard_summary(TEXT) TO anon, authenticated;
