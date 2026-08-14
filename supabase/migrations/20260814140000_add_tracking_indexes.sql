-- ============================================================================
-- Corporate Claim Tracking - Performance Indexes
-- ============================================================================
-- Purpose: Add indexes for efficient querying and pagination
-- These indexes improve performance for:
-- - Pagination with filtering
-- - Linkage table lookups
-- - JSONB data queries
-- ============================================================================

-- Index 1: Pagination support for snapshots
-- Enables efficient filtering by hospital, scheme, and date
CREATE INDEX IF NOT EXISTS idx_snapshots_hospital_scheme_date
ON corporate_claim_snapshots(hospital_name, scheme_code, created_at DESC);

-- Index 2: Hospital-based queries with date ordering
-- Used for showing recent files per hospital
CREATE INDEX IF NOT EXISTS idx_snapshots_hospital_date
ON corporate_claim_snapshots(hospital_name, created_at DESC);

-- Index 3: Duplicate file detection
-- Already exists from migration, but ensuring it's optimized
CREATE INDEX IF NOT EXISTS idx_snapshots_hash
ON corporate_claim_snapshots(content_hash);

-- Index 4: Linkage lookup by hospital and government ID
-- Critical for auto-match performance
CREATE INDEX IF NOT EXISTS idx_linkage_hospital_govt
ON patient_government_linkage(hospital_name, government_id);

-- Index 5: Linkage lookup by patient
-- Used for finding all government IDs for a patient
CREATE INDEX IF NOT EXISTS idx_linkage_patient
ON patient_government_linkage(patient_id);

-- Index 6: Linkage by match type
-- Useful for analytics on auto vs manual matches
CREATE INDEX IF NOT EXISTS idx_linkage_matched_by
ON patient_government_linkage(matched_by, linked_at DESC);

-- Index 7: JSONB GIN index for parsed data queries
-- Enables efficient JSONB contains/queries
CREATE INDEX IF NOT EXISTS idx_snapshots_parsed_gin
ON corporate_claim_snapshots USING GIN (parsed_data);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON INDEX idx_snapshots_hospital_scheme_date IS 'Supports pagination with hospital and scheme filtering';
COMMENT ON INDEX idx_snapshots_hospital_date IS 'Supports hospital-specific recent file queries';
COMMENT ON INDEX idx_snapshots_hash IS 'Enables fast duplicate file detection';
COMMENT ON INDEX idx_linkage_hospital_govt IS 'Critical for auto-match linkage lookups';
COMMENT ON INDEX idx_linkage_patient IS 'Supports reverse lookup: all government IDs for a patient';
COMMENT ON INDEX idx_linkage_matched_by IS 'Analytics for auto-match vs manual linkage performance';
COMMENT ON INDEX idx_snapshots_parsed_gin IS 'Enables efficient JSONB data queries';
