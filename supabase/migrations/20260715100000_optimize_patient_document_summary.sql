-- Support the paginated patient document summary without scanning the full
-- patient/upload join for every request.
CREATE INDEX IF NOT EXISTS file_uploads_patient_category_idx
  ON public.file_uploads (patient_id, category);

CREATE INDEX IF NOT EXISTS file_uploads_patient_id_normalized_category_idx
  ON public.file_uploads ((LOWER(TRIM(patient_id))), (LOWER(TRIM(category))));

CREATE INDEX IF NOT EXISTS file_uploads_patient_name_category_normalized_idx
  ON public.file_uploads (
    (LOWER(REGEXP_REPLACE(TRIM(patient_name), '\s+', ' ', 'g'))),
    (LOWER(TRIM(category)))
  );

CREATE INDEX IF NOT EXISTS patient_data_uuid_idx
  ON public.patient_data (patient_uuid);

CREATE INDEX IF NOT EXISTS patient_data_patient_id_idx
  ON public.patient_data (patient_id);

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
  WITH patient_status AS (
    SELECT
      p.patient_id,
      p.patient_uuid,
      p.patient_name,
      p.mrn,
      p.sr_no,
      COALESCE(upload_status.done_count, 0)::INTEGER AS done_count,
      (10 - COALESCE(upload_status.done_count, 0))::INTEGER AS pending_count
    FROM public.patient_data p
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT LOWER(TRIM(m.category)))::INTEGER AS done_count
      FROM (
        SELECT f.category
        FROM public.file_uploads f
        WHERE LOWER(TRIM(f.patient_id)) IN (
          NULLIF(LOWER(TRIM(p.patient_id)), ''),
          NULLIF(LOWER(TRIM(p.patient_uuid::TEXT)), '')
        )
          AND LOWER(TRIM(f.category)) IN (
            'treatment_sheet', 'monitor_chart', 'dialysis',
            'lab_investigation', 'radiology_investigation', 'ot_notes',
            'ot_photos', 'implant_invoice', 'implant_sticker',
            'discharge_summary'
          )

        UNION ALL

        SELECT f.category
        FROM public.file_uploads f
        WHERE LOWER(REGEXP_REPLACE(TRIM(f.patient_name), '\s+', ' ', 'g')) =
              LOWER(REGEXP_REPLACE(TRIM(p.patient_name), '\s+', ' ', 'g'))
          AND LOWER(TRIM(f.category)) IN (
            'treatment_sheet', 'monitor_chart', 'dialysis',
            'lab_investigation', 'radiology_investigation', 'ot_notes',
            'ot_photos', 'implant_invoice', 'implant_sticker',
            'discharge_summary'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.file_uploads exact_upload
            WHERE LOWER(TRIM(exact_upload.patient_id)) IN (
              NULLIF(LOWER(TRIM(p.patient_id)), ''),
              NULLIF(LOWER(TRIM(p.patient_uuid::TEXT)), '')
            )
              AND LOWER(TRIM(exact_upload.category)) IN (
                'treatment_sheet', 'monitor_chart', 'dialysis',
                'lab_investigation', 'radiology_investigation', 'ot_notes',
                'ot_photos', 'implant_invoice', 'implant_sticker',
                'discharge_summary'
              )
          )
      ) m
    ) upload_status ON TRUE
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
