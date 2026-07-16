-- Make the patient document report use the same source as Documents & Photos:
-- only patients with at least one canonical file_uploads row are included.
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
      ('treatment_sheet'), ('monitor_chart'), ('dialysis'),
      ('lab_investigation'), ('radiology_investigation'), ('ot_notes'),
      ('ot_photos'), ('implant_invoice'), ('implant_sticker'),
      ('discharge_summary')
  ),
  uploaded_patients AS (
    SELECT
      COALESCE(
        NULLIF(LOWER(TRIM(f.patient_id)), ''),
        'name:' || NULLIF(LOWER(REGEXP_REPLACE(TRIM(f.patient_name), '\s+', ' ', 'g')), '')
      ) AS upload_key,
      MAX(NULLIF(TRIM(f.patient_id), '')) AS upload_patient_id,
      MAX(NULLIF(TRIM(f.patient_name), '')) AS upload_patient_name,
      COUNT(DISTINCT LOWER(TRIM(f.category)))::INTEGER AS done_count
    FROM public.file_uploads f
    WHERE LOWER(TRIM(f.category)) IN (SELECT id FROM category_ids)
    GROUP BY COALESCE(
      NULLIF(LOWER(TRIM(f.patient_id)), ''),
      'name:' || NULLIF(LOWER(REGEXP_REPLACE(TRIM(f.patient_name), '\s+', ' ', 'g')), '')
    )
  ),
  patient_status AS (
    SELECT
      COALESCE(p.patient_id, u.upload_patient_id) AS patient_id,
      p.patient_uuid,
      COALESCE(NULLIF(TRIM(p.patient_name), ''), u.upload_patient_name) AS patient_name,
      p.mrn,
      p.sr_no,
      u.done_count,
      (SELECT COUNT(*)::INTEGER FROM category_ids) - u.done_count AS pending_count
    FROM uploaded_patients u
    LEFT JOIN public.patient_data p
      ON (
        NULLIF(LOWER(TRIM(u.upload_patient_id)), '') = NULLIF(LOWER(TRIM(p.patient_id)), '') OR
        NULLIF(LOWER(TRIM(u.upload_patient_id)), '') = NULLIF(LOWER(TRIM(p.patient_uuid::TEXT)), '') OR
        NULLIF(LOWER(REGEXP_REPLACE(TRIM(u.upload_patient_name), '\s+', ' ', 'g')), '') =
          NULLIF(LOWER(REGEXP_REPLACE(TRIM(p.patient_name), '\s+', ' ', 'g')), '')
      )
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
  ORDER BY f.pending_count DESC, f.sr_no DESC NULLS LAST, f.patient_name ASC
  LIMIT GREATEST(COALESCE(p_limit, 10), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
