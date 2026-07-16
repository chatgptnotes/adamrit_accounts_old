-- Paginated patient document summary, ordered by the patients needing the
-- most document follow-up. Uploads are matched by UUID, readable ID, or the
-- normalized patient name used by legacy uploads.
CREATE OR REPLACE FUNCTION public.get_patient_document_summary(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'all',
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  patient_id TEXT,
  patient_uuid UUID,
  patient_name TEXT,
  mrn TEXT,
  sr_no INTEGER,
  done_count INTEGER,
  pending_count INTEGER,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH category_ids(id) AS (
    VALUES
      ('treatment_sheet'),
      ('monitor_chart'),
      ('dialysis'),
      ('lab_investigation'),
      ('radiology_investigation'),
      ('ot_notes'),
      ('ot_photos'),
      ('implant_invoice'),
      ('implant_sticker'),
      ('discharge_summary')
  ),
  patient_status AS (
    SELECT
      p.patient_id,
      p.patient_uuid,
      p.patient_name,
      p.mrn,
      p.sr_no,
      COUNT(DISTINCT LOWER(TRIM(f.category)))::INTEGER AS done_count,
      (SELECT COUNT(*)::INTEGER FROM category_ids) -
        COUNT(DISTINCT LOWER(TRIM(f.category)))::INTEGER AS pending_count
    FROM public.patient_data p
    LEFT JOIN public.file_uploads f
      ON ((
        NULLIF(LOWER(TRIM(f.patient_id)), '') IS NOT NULL AND
        (
          NULLIF(LOWER(TRIM(f.patient_id)), '') = NULLIF(LOWER(TRIM(p.patient_id)), '') OR
          NULLIF(LOWER(TRIM(f.patient_id)), '') = NULLIF(LOWER(TRIM(p.patient_uuid::TEXT)), '')
        )
      )
      OR (
        NULLIF(LOWER(REGEXP_REPLACE(TRIM(f.patient_name), '\s+', ' ', 'g')), '') IS NOT NULL AND
        NULLIF(LOWER(REGEXP_REPLACE(TRIM(f.patient_name), '\s+', ' ', 'g')), '') =
        NULLIF(LOWER(REGEXP_REPLACE(TRIM(p.patient_name), '\s+', ' ', 'g')), '')
      ))
      AND LOWER(TRIM(f.category)) IN (SELECT id FROM category_ids)
    GROUP BY p.patient_id, p.patient_uuid, p.patient_name, p.mrn, p.sr_no
  ),
  filtered AS (
    SELECT ps.*
    FROM patient_status ps
    WHERE (
      NULLIF(TRIM(p_search), '') IS NULL OR
      ps.patient_name ILIKE '%' || TRIM(p_search) || '%' OR
      ps.patient_id ILIKE '%' || TRIM(p_search) || '%' OR
      ps.mrn ILIKE '%' || TRIM(p_search) || '%'
    )
    AND (
      LOWER(COALESCE(p_status, 'all')) = 'all' OR
      (LOWER(p_status) = 'pending' AND ps.pending_count > 0) OR
      (LOWER(p_status) = 'complete' AND ps.pending_count = 0)
    )
  )
  SELECT
    f.patient_id,
    f.patient_uuid,
    f.patient_name,
    f.mrn,
    f.sr_no,
    f.done_count,
    f.pending_count,
    COUNT(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.pending_count DESC, f.sr_no DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 10), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_patient_document_summary(TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated, anon;
