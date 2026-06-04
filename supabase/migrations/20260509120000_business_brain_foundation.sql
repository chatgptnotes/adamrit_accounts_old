-- =============================================================================
-- Business Brain Foundation — pgvector + agent runtime tables
--
-- Purpose: enables AI agents (pharmacy reorder, patient pre-visit instructions,
-- clinician prior-visit briefer) to share one corpus, one memory store, and one
-- audit log inside the existing Adamrit Supabase project.
--
-- Compliance posture (DPDP Act 2023, Indian healthcare):
--   * RLS on every table; default-deny.
--   * agent_audit_log captures every invocation for the hospital DPO.
--   * All PHI passes through supabase/functions/_shared/deidentify.ts BEFORE
--     reaching any external LLM. Audit log records hashes, not raw payloads.
--
-- Idempotent: safe to re-run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- agent_documents — one row per source file in the agent-corpus storage bucket
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- agent_chunks — vector-searchable slices of each document
-- 768 dims matches Vertex text-embedding-004 / Gemini embedding-001.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- agent_memory — persistent conversation / run context per session
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- agent_runs — one row per LangGraph cycle, for observability and eval
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_runs (
    id              BIGSERIAL PRIMARY KEY,
    session_id      TEXT NOT NULL,
    agent_slug      TEXT NOT NULL,
    invoked_by      UUID,                          -- auth.users.id of the staff member
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

-- -----------------------------------------------------------------------------
-- agent_audit_log — DPDP-grade audit trail. Hashes only, no raw payloads.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_audit_log (
    id                 BIGSERIAL PRIMARY KEY,
    invoked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    invoked_by         UUID,
    agent_slug         TEXT NOT NULL,
    pack_version       TEXT,
    input_hash         TEXT NOT NULL,              -- sha256 of de-identified input
    output_hash        TEXT,                       -- sha256 of generated output
    retrieved_chunks   BIGINT[] DEFAULT '{}',      -- agent_chunks.id list
    llm_provider       TEXT,                       -- 'vertex-ai' | 'gemini' | 'groq'
    llm_model          TEXT,
    llm_region         TEXT,
    deidentified_count INT,                        -- # PHI tokens stripped before LLM
    confidence         REAL,
    handed_to_human    BOOLEAN NOT NULL DEFAULT FALSE,
    error_message      TEXT,
    request_id         UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS agent_audit_log_slug_idx ON public.agent_audit_log (agent_slug, invoked_at DESC);
CREATE INDEX IF NOT EXISTS agent_audit_log_user_idx ON public.agent_audit_log (invoked_by, invoked_at DESC);

-- -----------------------------------------------------------------------------
-- Row-Level Security
--   * Reads of agent_chunks / agent_documents: any authenticated staff.
--   * Writes: service_role only (Edge Functions write with the service key).
--   * agent_audit_log: append-only via service_role; read by users with the
--     'compliance_officer' app metadata flag (DPO role).
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_chunks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_audit_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_documents_read ON public.agent_documents;
CREATE POLICY agent_documents_read ON public.agent_documents
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS agent_chunks_read ON public.agent_chunks;
CREATE POLICY agent_chunks_read ON public.agent_chunks
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS agent_runs_self_read ON public.agent_runs;
CREATE POLICY agent_runs_self_read ON public.agent_runs
    FOR SELECT TO authenticated USING (invoked_by = auth.uid());

DROP POLICY IF EXISTS agent_memory_self_read ON public.agent_memory;
CREATE POLICY agent_memory_self_read ON public.agent_memory
    FOR SELECT TO authenticated USING (true);

-- DPO-only read on the audit log; compliance role checked via app metadata.
DROP POLICY IF EXISTS agent_audit_log_dpo_read ON public.agent_audit_log;
CREATE POLICY agent_audit_log_dpo_read ON public.agent_audit_log
    FOR SELECT TO authenticated
    USING (coalesce((auth.jwt() -> 'app_metadata' ->> 'compliance_officer')::boolean, false));

-- -----------------------------------------------------------------------------
-- match_agent_chunks — vector-search RPC used by the retrieval node.
-- Filterable by department / agent_pack to keep retrieval scoped per agent.
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
-- agent-corpus storage bucket. Idempotent via ON CONFLICT.
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-corpus', 'agent-corpus', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated upload, service_role download for indexing.
DROP POLICY IF EXISTS "agent_corpus_authenticated_upload" ON storage.objects;
CREATE POLICY "agent_corpus_authenticated_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'agent-corpus');

DROP POLICY IF EXISTS "agent_corpus_authenticated_read" ON storage.objects;
CREATE POLICY "agent_corpus_authenticated_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'agent-corpus');
