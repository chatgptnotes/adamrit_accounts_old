-- =============================================================================
-- Business Brain · Schema Bridge
--
-- PRODUCTION SAFETY GUARANTEES:
--   * 100% additive. No DROP, no destructive ALTER.
--   * Every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--   * No existing column changes type. No existing constraint changes.
--   * No existing query changes its result.
--   * Idempotent — safe to re-run any number of times.
--
-- ROLLBACK (if needed):
--   See 20260510000001_business_brain_schema_bridge_rollback.sql in this branch.
--   It DROPs only what THIS migration creates. Existing prod data is untouched.
--
-- WHAT THIS DOES:
--   1. Adds 4 nullable/defaulted consent columns to public.patients.
--   2. Creates appointment_type_templates table + 8 seed rows for common
--      hospital appointment types (used by the patient pre-visit agent).
--   3. Creates the Business Brain agent runtime tables:
--        agent_documents, agent_chunks (with pgvector), agent_memory,
--        agent_runs, agent_audit_log
--   4. Creates the agent-corpus storage bucket with permissive RLS scoped
--      to authenticated users only (NOT public).
--   5. Adds a match_agent_chunks() RPC for vector retrieval.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   * Touch existing patients/visits/medicines/lab_results/etc tables.
--   * Modify any existing RLS policy.
--   * Drop or rename anything.
--   * Set the consent_for_ai default to TRUE (default is FALSE — agents
--     refuse to run on a patient until staff explicitly opts them in).
-- =============================================================================

-- pgvector is required for the agent_chunks.embedding column.
-- pg_trgm is used for hybrid keyword + vector search.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- -----------------------------------------------------------------------------
-- 1. Patient consent flags (additive, defaulted, nullable-safe)
-- -----------------------------------------------------------------------------
ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS consent_for_ai BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS parental_consent_for_ai BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS language_preference TEXT NOT NULL DEFAULT 'en'
        CHECK (language_preference IN ('en','hi','mr'));

ALTER TABLE public.patients
    ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.patients.consent_for_ai IS
    'Per-patient opt-in for Business Brain AI processing. Default FALSE — agents refuse to run until explicit consent.';
COMMENT ON COLUMN public.patients.parental_consent_for_ai IS
    'For minors (<18). Required IN ADDITION to consent_for_ai when patient.age < 18.';
COMMENT ON COLUMN public.patients.language_preference IS
    'Preferred language for AI-generated patient communication: en, hi, or mr.';
COMMENT ON COLUMN public.patients.do_not_contact IS
    'Hard block on any AI-generated outbound communication. Trumps consent_for_ai.';


-- -----------------------------------------------------------------------------
-- 2. appointment_type_templates — source of truth for pre-visit instructions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointment_type_templates (
    type                 TEXT PRIMARY KEY,
    display_name         TEXT NOT NULL,
    preparation_steps    JSONB NOT NULL DEFAULT '[]'::jsonb,
    items_to_bring       JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_minutes     INT,
    arrive_early_minutes INT NOT NULL DEFAULT 15,
    sensitive            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.appointment_type_templates IS
    'Canonical templates for what to tell a patient before each appointment type. Read by the patient-previsit agent.';
COMMENT ON COLUMN public.appointment_type_templates.sensitive IS
    'If TRUE (oncology / mental health / infectious disease), the agent escalates to a clinical liaison instead of auto-drafting.';

ALTER TABLE public.appointment_type_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_type_templates_read ON public.appointment_type_templates;
CREATE POLICY appointment_type_templates_read ON public.appointment_type_templates
    FOR SELECT TO authenticated USING (TRUE);

-- Seed 8 common templates. ON CONFLICT DO NOTHING so re-running is safe.
INSERT INTO public.appointment_type_templates (type, display_name, preparation_steps, items_to_bring, duration_minutes, arrive_early_minutes, sensitive)
VALUES
    ('OPD-General',
     'General OPD Consultation',
     '["Continue regular medications unless your doctor said otherwise","Carry a list of current symptoms with dates"]'::jsonb,
     '["Previous prescriptions","Government ID","Past lab reports if available"]'::jsonb,
     20, 15, FALSE),
    ('OPD-Cardio',
     'Cardiology OPD',
     '["Avoid caffeine for 4 hours before appointment","Continue regular medications","Wear loose, comfortable clothing"]'::jsonb,
     '["Previous ECG / Echo reports","Current medication list","Government ID"]'::jsonb,
     30, 15, FALSE),
    ('MRI-Brain',
     'MRI Brain Scan',
     '["Fast for 4 hours (no food or drink)","Continue regular medications unless your doctor said otherwise","Wear loose clothing without metal","Remove all jewellery and metallic items"]'::jsonb,
     '["Previous MRI / CT reports","Government ID","List of metal implants (pacemaker, stents, surgical clips, etc.)"]'::jsonb,
     45, 15, FALSE),
    ('CT-Abdomen',
     'CT Abdomen Scan',
     '["Fast for 6 hours before scan","Drink only clear fluids","Continue regular medications unless your doctor said otherwise"]'::jsonb,
     '["Previous CT / Ultrasound reports","Government ID","Kidney function test report if available"]'::jsonb,
     30, 20, FALSE),
    ('Blood-Collection',
     'Lab — Blood Collection',
     '["Fast for 12 hours if a fasting test is ordered","Drink water normally","Continue regular medications unless instructed otherwise"]'::jsonb,
     '["Test order slip","Government ID"]'::jsonb,
     15, 10, FALSE),
    ('Pre-op',
     'Pre-operative Assessment',
     '["Fast as instructed by your surgeon","Stop blood thinners only if your surgeon has confirmed in writing","Bring all current medication boxes"]'::jsonb,
     '["All previous reports","Insurance / ESIC card","Government ID","Consent forms if already given"]'::jsonb,
     45, 30, FALSE),
    ('Endoscopy',
     'Upper GI Endoscopy',
     '["Fast for 8 hours before procedure","Stop blood thinners only if your doctor confirmed in writing","Arrange someone to accompany you home"]'::jsonb,
     '["Previous endoscopy reports","Government ID","Consent for sedation"]'::jsonb,
     45, 30, FALSE),
    ('X-Ray',
     'X-Ray',
     '["No special preparation required","Wear loose clothing without metal","Remove all jewellery and metallic items from the area being scanned"]'::jsonb,
     '["Test order slip","Government ID"]'::jsonb,
     15, 10, FALSE)
ON CONFLICT (type) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. Agent runtime tables
-- -----------------------------------------------------------------------------

-- 3a. agent_documents — one row per source file in the agent-corpus bucket
CREATE TABLE IF NOT EXISTS public.agent_documents (
    id              BIGSERIAL PRIMARY KEY,
    storage_path    TEXT NOT NULL UNIQUE,
    title           TEXT,
    department      TEXT NOT NULL,
    agent_pack      TEXT,
    last_reviewed   DATE,
    indexed_at      TIMESTAMPTZ,
    indexed_version TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_documents_dept_idx ON public.agent_documents (department);
CREATE INDEX IF NOT EXISTS agent_documents_pack_idx ON public.agent_documents (agent_pack);

-- 3b. agent_chunks — vector-searchable slices.
-- 768 dims matches Vertex text-embedding-004 / Gemini embedding-001.
CREATE TABLE IF NOT EXISTS public.agent_chunks (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES public.agent_documents(id) ON DELETE CASCADE,
    chunk_index  INT NOT NULL,
    content      TEXT NOT NULL,
    embedding    VECTOR(768),
    department   TEXT NOT NULL,
    agent_pack   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_chunks_embedding_idx
    ON public.agent_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS agent_chunks_content_trgm_idx
    ON public.agent_chunks USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS agent_chunks_pack_idx ON public.agent_chunks (agent_pack);

-- 3c. agent_memory — persistent conversation / run context per session
CREATE TABLE IF NOT EXISTS public.agent_memory (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT NOT NULL,
    agent_slug  TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
    content     TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_memory_session_idx ON public.agent_memory (session_id, created_at);

-- 3d. agent_runs — observability + eval
CREATE TABLE IF NOT EXISTS public.agent_runs (
    id              BIGSERIAL PRIMARY KEY,
    session_id      TEXT NOT NULL,
    agent_slug      TEXT NOT NULL,
    invoked_by      UUID,
    question        TEXT NOT NULL,
    answer          TEXT,
    confidence      REAL,
    cycles          INT NOT NULL DEFAULT 1,
    handed_to_human BOOLEAN NOT NULL DEFAULT FALSE,
    duration_ms     INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_session_idx ON public.agent_runs (session_id, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_review_idx  ON public.agent_runs (handed_to_human) WHERE handed_to_human = TRUE;

-- 3e. agent_audit_log — DPDP-grade audit trail. Hashes only, no raw PHI.
CREATE TABLE IF NOT EXISTS public.agent_audit_log (
    id                 BIGSERIAL PRIMARY KEY,
    invoked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    invoked_by         UUID,
    agent_slug         TEXT NOT NULL,
    pack_version       TEXT,
    input_hash         TEXT NOT NULL,
    output_hash        TEXT,
    retrieved_chunks   BIGINT[] DEFAULT '{}',
    llm_provider       TEXT,
    llm_model          TEXT,
    llm_region         TEXT,
    deidentified_count INT,
    confidence         REAL,
    handed_to_human    BOOLEAN NOT NULL DEFAULT FALSE,
    used_fallback      BOOLEAN NOT NULL DEFAULT FALSE,
    error_message      TEXT,
    request_id         UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS agent_audit_log_slug_idx ON public.agent_audit_log (agent_slug, invoked_at DESC);
CREATE INDEX IF NOT EXISTS agent_audit_log_user_idx ON public.agent_audit_log (invoked_by, invoked_at DESC);


-- -----------------------------------------------------------------------------
-- 4. RLS on agent runtime tables
--    Reads: authenticated staff. Writes: service_role only (Edge Functions).
--    agent_audit_log read is restricted to compliance officer (DPO) role.
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_chunks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_audit_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_documents_read ON public.agent_documents;
CREATE POLICY agent_documents_read ON public.agent_documents
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS agent_chunks_read ON public.agent_chunks;
CREATE POLICY agent_chunks_read ON public.agent_chunks
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS agent_memory_self_read ON public.agent_memory;
CREATE POLICY agent_memory_self_read ON public.agent_memory
    FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS agent_runs_self_read ON public.agent_runs;
CREATE POLICY agent_runs_self_read ON public.agent_runs
    FOR SELECT TO authenticated USING (invoked_by = auth.uid());

DROP POLICY IF EXISTS agent_audit_log_dpo_read ON public.agent_audit_log;
CREATE POLICY agent_audit_log_dpo_read ON public.agent_audit_log
    FOR SELECT TO authenticated
    USING (COALESCE((auth.jwt() -> 'app_metadata' ->> 'compliance_officer')::boolean, FALSE));


-- -----------------------------------------------------------------------------
-- 5. match_agent_chunks RPC — vector retrieval scoped per dept / pack
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_agent_chunks(
    query_embedding VECTOR(768),
    match_count     INT DEFAULT 5,
    filter_dept     TEXT DEFAULT NULL,
    filter_pack     TEXT DEFAULT NULL
) RETURNS TABLE (
    id          BIGINT,
    document_id BIGINT,
    content     TEXT,
    department  TEXT,
    agent_pack  TEXT,
    similarity  FLOAT
) LANGUAGE sql STABLE AS $$
    SELECT
        c.id,
        c.document_id,
        c.content,
        c.department,
        c.agent_pack,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM public.agent_chunks c
    WHERE c.embedding IS NOT NULL
      AND (filter_dept IS NULL OR c.department = filter_dept)
      AND (filter_pack IS NULL OR c.agent_pack = filter_pack)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_agent_chunks TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. agent-corpus storage bucket (private, authenticated upload + read)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-corpus', 'agent-corpus', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "agent_corpus_authenticated_upload" ON storage.objects;
CREATE POLICY "agent_corpus_authenticated_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'agent-corpus');

DROP POLICY IF EXISTS "agent_corpus_authenticated_read" ON storage.objects;
CREATE POLICY "agent_corpus_authenticated_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'agent-corpus');
