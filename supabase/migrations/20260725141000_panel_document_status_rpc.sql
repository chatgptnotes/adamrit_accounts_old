-- Panel-wise mandatory document status, per patient.
--
-- The panel -> required-documents map is deliberately NOT in this file. It is
-- passed in as p_panels on every call from src/lib/registrationDocuments.ts,
-- which stays the single source of truth. This function hardcodes no panel and
-- no document name: it is a generic set difference between "required" (from
-- p_panels) and "uploaded (file_uploads) + waived (panel_document_waivers)".
-- A SQL copy of the map would silently drift the first time a panel changed.
--
-- p_panels shape (keys and corporates pre-normalized by the client — lowercase,
-- trimmed, internal whitespace collapsed, matching normalize() in the TS file):
--   [{"panel":"ESIC",
--     "corporates":["esic","employees state insurance corporation (esic)"],
--     "documents":[{"key":"aadhaar card","label":"Aadhaar Card"}]}]
--
-- Run in the Supabase dashboard SQL editor. Safe to run twice.

-- file_uploads.notes holds free text as well as our JSON, so a bare
-- notes::jsonb would raise on the first non-JSON row.
CREATE OR REPLACE FUNCTION public.try_parse_jsonb(p_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.try_parse_jsonb(TEXT) IS
'Parse text as jsonb, returning NULL instead of raising when the text is not valid JSON.';

-- Narrow the patient scan to one panel's corporate spellings.
CREATE INDEX IF NOT EXISTS patients_corporate_normalized_idx
  ON public.patients ((lower(regexp_replace(btrim(corporate), '\s+', ' ', 'g'))));

CREATE INDEX IF NOT EXISTS patients_hospital_created_idx
  ON public.patients (hospital_name, created_at DESC);

-- Registration documents are a small slice of file_uploads; a partial index
-- keeps the join off the full table. (patient_id is TEXT here, and holds either
-- patients.id::text or patients.patients_id depending on the upload path.)
CREATE INDEX IF NOT EXISTS file_uploads_registration_document_patient_idx
  ON public.file_uploads ((lower(btrim(patient_id))))
  WHERE lower(btrim(category)) = 'registration_document';

CREATE OR REPLACE FUNCTION public.get_panel_document_status(
  p_panels        JSONB,
  p_hospital_name TEXT    DEFAULT NULL,   -- NULL = both hospitals
  p_panel         TEXT    DEFAULT NULL,   -- one panel key, or NULL for all
  p_search        TEXT    DEFAULT NULL,   -- patient name or UHID
  p_status        TEXT    DEFAULT 'pending',  -- 'pending' | 'complete' | 'all'
  p_limit         INTEGER DEFAULT 50,
  p_offset        INTEGER DEFAULT 0,
  -- One exact patient, for the bell's deep link into the checklist. Bypasses
  -- p_status so the screen still opens after the last document is submitted.
  p_patient_uuid  UUID    DEFAULT NULL
)
RETURNS TABLE (
  patient_uuid        UUID,
  patients_id         TEXT,
  patient_name        TEXT,
  corporate           TEXT,
  panel               TEXT,
  hospital_name       TEXT,
  registered_at       TIMESTAMPTZ,
  required_count      INTEGER,
  submitted_count     INTEGER,
  waived_count        INTEGER,
  pending_count       INTEGER,
  pending_documents   TEXT[],
  submitted_documents TEXT[],
  waived_documents    TEXT[],
  total_count         BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH panel_input AS (
    SELECT elem->>'panel'     AS panel,
           elem->'corporates' AS corporates,
           elem->'documents'  AS documents
      FROM jsonb_array_elements(COALESCE(p_panels, '[]'::jsonb)) AS elem
     WHERE NULLIF(btrim(p_panel), '') IS NULL
        OR elem->>'panel' = btrim(p_panel)
  ),
  -- One row per corporate spelling. DISTINCT ON guards against a spelling
  -- listed under two panels resolving ambiguously (CR/SECR share aliases).
  panel_corporate AS (
    SELECT DISTINCT ON (c.value) c.value AS corporate_key, pi.panel
      FROM panel_input pi
      CROSS JOIN LATERAL jsonb_array_elements_text(pi.corporates) AS c(value)
     ORDER BY c.value, pi.panel
  ),
  panel_document AS (
    SELECT pi.panel,
           d.value->>'key'   AS document_key,
           d.value->>'label' AS document_label,
           d.ordinality      AS document_order
      FROM panel_input pi
      CROSS JOIN LATERAL jsonb_array_elements(pi.documents)
        WITH ORDINALITY AS d(value, ordinality)
  ),
  panel_patient AS (
    SELECT p.id, p.patients_id, p.name, p.corporate,
           p.hospital_name, p.created_at, pc.panel
      FROM public.patients p
      JOIN panel_corporate pc
        ON pc.corporate_key = lower(regexp_replace(btrim(p.corporate), '\s+', ' ', 'g'))
     WHERE (p_patient_uuid IS NULL OR p.id = p_patient_uuid)
       AND (NULLIF(btrim(p_hospital_name), '') IS NULL
            OR lower(btrim(p.hospital_name)) = lower(btrim(p_hospital_name)))
       AND (NULLIF(btrim(p_search), '') IS NULL
            OR p.name        ILIKE '%' || btrim(p_search) || '%'
            OR p.patients_id ILIKE '%' || btrim(p_search) || '%')
  ),
  -- Submitted is DERIVED: an upload whose notes JSON names this document.
  -- patient_id is matched against both the UUID and the UHID because the two
  -- upload paths write different values (same convention as
  -- get_patient_document_summary).
  submitted AS (
    SELECT DISTINCT pp.id AS patient_uuid,
           lower(regexp_replace(
             btrim(public.try_parse_jsonb(f.notes)->>'documentName'),
             '\s+', ' ', 'g')) AS document_key
      FROM panel_patient pp
      JOIN public.file_uploads f
        ON lower(btrim(f.category)) = 'registration_document'
       AND lower(btrim(f.patient_id)) IN (
             lower(pp.id::text),
             NULLIF(lower(btrim(pp.patients_id)), ''))
     WHERE public.try_parse_jsonb(f.notes)->>'documentName' IS NOT NULL
  ),
  waived AS (
    SELECT DISTINCT w.patient_id AS patient_uuid,
           lower(regexp_replace(btrim(w.document_name), '\s+', ' ', 'g')) AS document_key
      FROM public.panel_document_waivers w
      JOIN panel_patient pp ON pp.id = w.patient_id
  ),
  -- One row per (patient, required document) with its resolved state.
  matrix AS (
    SELECT pp.id, pp.patients_id, pp.name, pp.corporate, pp.panel,
           pp.hospital_name, pp.created_at,
           pd.document_label, pd.document_order,
           (s.document_key IS NOT NULL)  AS is_submitted,
           (wv.document_key IS NOT NULL) AS is_waived
      FROM panel_patient pp
      JOIN panel_document pd ON pd.panel = pp.panel
      LEFT JOIN submitted s ON s.patient_uuid = pp.id AND s.document_key = pd.document_key
      LEFT JOIN waived   wv ON wv.patient_uuid = pp.id AND wv.document_key = pd.document_key
  ),
  -- Submitted wins over waived, so a document that was marked N/A and later
  -- uploaded counts once, as Submitted.
  rolled AS (
    SELECT m.id AS patient_uuid, m.patients_id, m.name AS patient_name,
           m.corporate, m.panel, m.hospital_name,
           m.created_at AS registered_at,
           COUNT(*)::INTEGER AS required_count,
           COUNT(*) FILTER (WHERE m.is_submitted)::INTEGER AS submitted_count,
           COUNT(*) FILTER (WHERE NOT m.is_submitted AND m.is_waived)::INTEGER AS waived_count,
           COUNT(*) FILTER (WHERE NOT m.is_submitted AND NOT m.is_waived)::INTEGER AS pending_count,
           COALESCE(ARRAY_AGG(m.document_label ORDER BY m.document_order)
                    FILTER (WHERE NOT m.is_submitted AND NOT m.is_waived), '{}') AS pending_documents,
           COALESCE(ARRAY_AGG(m.document_label ORDER BY m.document_order)
                    FILTER (WHERE m.is_submitted), '{}') AS submitted_documents,
           COALESCE(ARRAY_AGG(m.document_label ORDER BY m.document_order)
                    FILTER (WHERE NOT m.is_submitted AND m.is_waived), '{}') AS waived_documents
      FROM matrix m
     GROUP BY m.id, m.patients_id, m.name, m.corporate, m.panel,
              m.hospital_name, m.created_at
  ),
  filtered AS (
    SELECT r.* FROM rolled r
     WHERE p_patient_uuid IS NOT NULL
        OR lower(COALESCE(p_status, 'pending')) = 'all'
        OR (lower(p_status) = 'pending'  AND r.pending_count > 0)
        OR (lower(p_status) = 'complete' AND r.pending_count = 0)
  )
  -- total_count is the size of `filtered` BEFORE pagination, so one call gives
  -- both the page and the true total (no second count round-trip).
  SELECT f.patient_uuid, f.patients_id, f.patient_name, f.corporate, f.panel,
         f.hospital_name, f.registered_at, f.required_count, f.submitted_count,
         f.waived_count, f.pending_count, f.pending_documents,
         f.submitted_documents, f.waived_documents,
         COUNT(*) OVER () AS total_count
    FROM filtered f
   ORDER BY f.registered_at DESC NULLS LAST, f.patient_name
   LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_panel_document_status(JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_panel_document_status(JSONB, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID) IS
'Per-patient panel document checklist. The panel->documents map is supplied by the caller (src/lib/registrationDocuments.ts) so it is never duplicated in SQL. total_count is the pre-pagination size of the filtered set.';

-- Diagnostic. getCorporateRegistrationDocuments() matches corporate names by
-- EXACT alias, so any spelling missing from CORPORATE_NAME_ALIASES returns no
-- required documents and the patient silently vanishes from both the checklist
-- and the bell. The UI compares this list against the known aliases and warns.
CREATE OR REPLACE FUNCTION public.get_corporate_patient_counts(
  p_hospital_name TEXT DEFAULT NULL
)
RETURNS TABLE (corporate TEXT, patient_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT btrim(p.corporate) AS corporate, COUNT(*) AS patient_count
    FROM public.patients p
   WHERE NULLIF(btrim(p.corporate), '') IS NOT NULL
     AND (NULLIF(btrim(p_hospital_name), '') IS NULL
          OR lower(btrim(p.hospital_name)) = lower(btrim(p_hospital_name)))
   GROUP BY btrim(p.corporate)
   ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_corporate_patient_counts(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
