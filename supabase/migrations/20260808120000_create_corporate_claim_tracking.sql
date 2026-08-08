-- Corporate claim tracking is intentionally isolated from the existing HMIS.
-- This migration creates new objects only. It never alters existing tables or data.

CREATE TABLE IF NOT EXISTS public.corporate_claim_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT NOT NULL,
  scheme_code TEXT NOT NULL CHECK (scheme_code IN ('PMJAY', 'MJPJAY', 'UNRESOLVED')),
  source_kind TEXT NOT NULL DEFAULT 'portal' CHECK (source_kind IN ('portal', 'system_initial_import')),
  portal_report_date DATE,
  snapshot_state TEXT NOT NULL DEFAULT 'incomplete' CHECK (snapshot_state IN ('complete', 'incomplete')),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0, invalid_rows INTEGER NOT NULL DEFAULT 0,
  matched_rows INTEGER NOT NULL DEFAULT 0, unmatched_rows INTEGER NOT NULL DEFAULT 0, duplicate_rows INTEGER NOT NULL DEFAULT 0,
  conflict_rows INTEGER NOT NULL DEFAULT 0, error_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_import_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.corporate_claim_import_batches(id),
  source_file_name TEXT NOT NULL, source_hash TEXT NOT NULL, mime_type TEXT,
  detected_file_type TEXT NOT NULL CHECK (detected_file_type IN ('under_treatment','claims_to_be_submitted','claims_sent_to_bank','pending_with_payer','claims_approved_from_bank','claims_rejected','unknown')),
  delimiter TEXT, header_map JSONB NOT NULL DEFAULT '{}'::jsonb, validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_rows INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0, invalid_rows INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corporate_claim_import_files_source_hash_unique UNIQUE (source_hash)
);

CREATE TABLE IF NOT EXISTS public.corporate_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT NOT NULL, scheme_code TEXT NOT NULL CHECK (scheme_code IN ('PMJAY','MJPJAY','UNRESOLVED')),
  government_registration_id TEXT, normalized_registration_id TEXT, government_program_id TEXT, normalized_program_id TEXT,
  external_claim_number TEXT, bill_number TEXT, beneficiary_name TEXT,
  matched_patient_id UUID, matched_visit_id UUID, match_state TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_state IN ('unmatched','matched','ambiguous','conflict','manual_match')),
  current_stage TEXT NOT NULL DEFAULT 'under_treatment' CHECK (current_stage IN ('under_treatment','claims_to_be_submitted','claims_sent_to_bank','pending_with_payer','payment_initiated','payment_accomplished','government_query','rejected')),
  raw_government_status TEXT, payment_state TEXT NOT NULL DEFAULT 'not_due' CHECK (payment_state IN ('not_due','pending','received','partial','rejected','unknown')),
  query_state TEXT NOT NULL DEFAULT 'none' CHECK (query_state IN ('none','active','awaiting_government_confirmation','resolved')),
  claimed_amount NUMERIC(14,2), approved_amount NUMERIC(14,2), paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_source_observed_on DATE, last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corporate_claims_external_identity UNIQUE NULLS NOT DISTINCT (hospital_name, scheme_code, normalized_registration_id)
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_file_id UUID NOT NULL REFERENCES public.corporate_claim_import_files(id),
  claim_id UUID REFERENCES public.corporate_claims(id),
  row_number INTEGER NOT NULL, row_fingerprint TEXT NOT NULL, original_values JSONB NOT NULL, normalized_values JSONB NOT NULL,
  detected_stage TEXT, parse_errors JSONB NOT NULL DEFAULT '[]'::jsonb, is_duplicate BOOLEAN NOT NULL DEFAULT false,
  match_outcome TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_outcome IN ('unmatched','matched','ambiguous','conflict','manual_match')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT corporate_claim_import_rows_file_row_unique UNIQUE (import_file_id, row_number),
  CONSTRAINT corporate_claim_import_rows_fingerprint_unique UNIQUE (row_fingerprint)
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES public.corporate_claims(id),
  import_row_id UUID REFERENCES public.corporate_claim_import_rows(id),
  prior_stage TEXT, new_stage TEXT NOT NULL, raw_source_status TEXT, effective_report_date DATE, actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES public.corporate_claims(id),
  import_row_id UUID REFERENCES public.corporate_claim_import_rows(id),
  transaction_fingerprint TEXT NOT NULL UNIQUE, approved_amount NUMERIC(14,2), paid_amount NUMERIC(14,2) NOT NULL,
  payment_date DATE, utr TEXT, tds_amount NUMERIC(14,2), rf_amount NUMERIC(14,2), government_case_status TEXT,
  source_kind TEXT NOT NULL DEFAULT 'portal' CHECK (source_kind IN ('portal','manual')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES public.corporate_claims(id),
  import_row_id UUID REFERENCES public.corporate_claim_import_rows(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('portal','manual')), original_remark TEXT, query_type TEXT, required_action TEXT,
  hospital_action TEXT, workflow_state TEXT NOT NULL DEFAULT 'active' CHECK (workflow_state IN ('active','awaiting_government_confirmation','resolved')),
  resubmitted_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, actor TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID NOT NULL REFERENCES public.corporate_claims(id),
  import_row_id UUID REFERENCES public.corporate_claim_import_rows(id),
  patient_id UUID, visit_id UUID, method TEXT NOT NULL, confidence TEXT NOT NULL,
  candidate_evidence JSONB NOT NULL DEFAULT '[]'::jsonb, is_approved BOOLEAN NOT NULL DEFAULT false, reviewed_by TEXT,
  superseded_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID REFERENCES public.corporate_claims(id),
  import_row_id UUID REFERENCES public.corporate_claim_import_rows(id),
  hospital_name TEXT NOT NULL, scheme_code TEXT NOT NULL, review_type TEXT NOT NULL CHECK (review_type IN ('unmatched','ambiguous','conflict','malformed','scheme_resolution','identifier_conflict')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by TEXT, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corporate_claim_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), claim_id UUID REFERENCES public.corporate_claims(id),
  batch_id UUID REFERENCES public.corporate_claim_import_batches(id),
  import_file_id UUID REFERENCES public.corporate_claim_import_files(id),
  import_row_id UUID REFERENCES public.corporate_claim_import_rows(id),
  hospital_name TEXT NOT NULL, scheme_code TEXT NOT NULL, event_type TEXT NOT NULL, actor TEXT,
  before_values JSONB, after_values JSONB, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corporate_claims_scope_stage ON public.corporate_claims(hospital_name, scheme_code, current_stage);
CREATE INDEX IF NOT EXISTS idx_corporate_claims_registration ON public.corporate_claims(normalized_registration_id);
CREATE INDEX IF NOT EXISTS idx_corporate_claims_program ON public.corporate_claims(normalized_program_id);
CREATE INDEX IF NOT EXISTS idx_corporate_claims_match ON public.corporate_claims(matched_patient_id, matched_visit_id);
CREATE INDEX IF NOT EXISTS idx_corporate_claim_rows_claim ON public.corporate_claim_import_rows(claim_id);
CREATE INDEX IF NOT EXISTS idx_corporate_claim_payments_utr ON public.corporate_claim_payment_transactions(utr) WHERE utr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_corporate_claim_reviews_open ON public.corporate_claim_review_items(hospital_name, scheme_code, created_at DESC) WHERE status = 'open';

-- Tracking data is read-only to authenticated application users. Inserts and updates
-- are intentionally reserved for the controlled import/review service (service role).
ALTER TABLE public.corporate_claim_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_claim_audit_events ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['corporate_claim_import_batches','corporate_claim_import_files','corporate_claim_import_rows','corporate_claims','corporate_claim_status_history','corporate_claim_payment_transactions','corporate_claim_queries','corporate_claim_matches','corporate_claim_review_items','corporate_claim_audit_events'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', table_name || '_authenticated_read', table_name);
  END LOOP;
END $$;
