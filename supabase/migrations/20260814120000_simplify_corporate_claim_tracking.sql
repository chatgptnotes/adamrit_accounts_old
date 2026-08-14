-- ============================================================================
-- Simplify Corporate Claim Tracking
-- ============================================================================
-- This migration simplifies the corporate claim tracking system by:
-- 1. Dropping the 10 overbuilt tables that duplicate existing data
-- 2. Creating 1 simple table to store parsed file snapshots
-- 3. Using existing patients/visits tables for verification (no duplication)
--
-- Benefits:
-- - No Edge Functions needed
-- - No RAM spikes during import
-- - Shows live admission status from existing visits table
-- - Simpler codebase (1 table instead of 10)
-- ============================================================================

-- Drop the overbuilt tables if they exist (CASCADE to drop dependencies)
-- Order matters: drop dependent tables first
DROP TABLE IF EXISTS corporate_claim_audit_events CASCADE;
DROP TABLE IF EXISTS corporate_claim_review_items CASCADE;
DROP TABLE IF EXISTS corporate_claim_queries CASCADE;
DROP TABLE IF EXISTS corporate_claim_payment_transactions CASCADE;
DROP TABLE IF EXISTS corporate_claim_status_history CASCADE;
DROP TABLE IF EXISTS corporate_claim_matches CASCADE;
DROP TABLE IF EXISTS corporate_claim_import_rows CASCADE;
DROP TABLE IF EXISTS corporate_claim_import_files CASCADE;
DROP TABLE IF EXISTS corporate_claim_import_batches CASCADE;
DROP TABLE IF EXISTS corporate_claims CASCADE;

-- ============================================================================
-- Create Simple Snapshot Storage
-- ============================================================================
-- This table stores parsed government portal files as JSON snapshots.
-- Verification is done by querying existing patients/visits tables directly.
-- ============================================================================

CREATE TABLE corporate_claim_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT NOT NULL,
  scheme_code TEXT NOT NULL,                -- 'PMJAY', 'MJPJAY', or 'ALL'
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  parsed_data JSONB NOT NULL,               -- Entire parsed file content
  content_hash TEXT NOT NULL,               -- SHA-256 for duplicate detection
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE corporate_claim_snapshots ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read their hospital's snapshots
CREATE POLICY "Users can read own snapshots"
  ON corporate_claim_snapshots
  FOR SELECT
  TO authenticated
  USING (
    hospital_name = (current_setting('app.current_hospital', true))
  );

-- Policy: Authenticated users can insert their hospital's snapshots
CREATE POLICY "Users can insert own snapshots"
  ON corporate_claim_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    hospital_name = (current_setting('app.current_hospital', true))
  );

-- ============================================================================
-- Indexes
-- ============================================================================

-- Index for duplicate file detection
CREATE INDEX idx_snapshots_hash ON corporate_claim_snapshots(content_hash);

-- Index for hospital queries
CREATE INDEX idx_snapshots_hospital ON corporate_claim_snapshots(hospital_name, created_at DESC);

-- Index on JSONB data for efficient querying
CREATE INDEX idx_snapshots_data ON corporate_claim_snapshots USING GIN (parsed_data);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE corporate_claim_snapshots IS 'Stores parsed government portal claim files as snapshots. Verification uses existing patients/visits tables.';
COMMENT ON COLUMN corporate_claim_snapshots.content_hash IS 'SHA-256 hash of file content for duplicate detection';
COMMENT ON COLUMN corporate_claim_snapshots.parsed_data IS 'JSONB storage of entire parsed file content';
