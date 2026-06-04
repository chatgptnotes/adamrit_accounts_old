-- =============================================================================
-- Business Brain · Schema Bridge ROLLBACK
--
-- Run this manually only if the bridge migration must be undone.
-- This file lives in docs/, NOT in supabase/migrations/, so it does NOT run
-- automatically on `supabase db push`.
--
-- WHAT THIS DROPS (only what 20260510000000 created):
--   * agent_audit_log, agent_runs, agent_memory, agent_chunks, agent_documents
--   * appointment_type_templates
--   * 4 columns on patients (consent_for_ai, parental_consent_for_ai,
--     language_preference, do_not_contact)
--   * agent-corpus storage bucket + its 2 policies
--   * match_agent_chunks RPC
--
-- WHAT THIS DOES NOT TOUCH:
--   * pgvector / pg_trgm extensions (other features may use them)
--   * Anything else in adamrit
--
-- HOW TO RUN (only if you really mean it):
--   supabase db connect
--   \i docs/business-brain/rollback_business_brain_schema_bridge.sql
-- =============================================================================

-- 1. Drop the storage bucket policies + bucket
DROP POLICY IF EXISTS "agent_corpus_authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "agent_corpus_authenticated_read"   ON storage.objects;

-- Only delete the bucket if it's empty. If it contains data, the operator
-- must consciously remove the data first — failing here on purpose.
DELETE FROM storage.buckets
    WHERE id = 'agent-corpus'
      AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'agent-corpus');

-- 2. Drop the RPC
DROP FUNCTION IF EXISTS public.match_agent_chunks(VECTOR, INT, TEXT, TEXT);

-- 3. Drop the agent runtime tables (CASCADE handles FK from agent_chunks)
DROP TABLE IF EXISTS public.agent_audit_log;
DROP TABLE IF EXISTS public.agent_runs;
DROP TABLE IF EXISTS public.agent_memory;
DROP TABLE IF EXISTS public.agent_chunks;
DROP TABLE IF EXISTS public.agent_documents;

-- 4. Drop the appointment type templates table
DROP TABLE IF EXISTS public.appointment_type_templates;

-- 5. Drop the patient consent columns
ALTER TABLE public.patients DROP COLUMN IF EXISTS consent_for_ai;
ALTER TABLE public.patients DROP COLUMN IF EXISTS parental_consent_for_ai;
ALTER TABLE public.patients DROP COLUMN IF EXISTS language_preference;
ALTER TABLE public.patients DROP COLUMN IF EXISTS do_not_contact;
