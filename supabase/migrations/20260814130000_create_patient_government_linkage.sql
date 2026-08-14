-- ============================================================================
-- Patient Government Linkage Table
-- ============================================================================
-- Purpose: Store linkages between government portal IDs and Adamrit patients
-- Enables automatic matching by name + date on subsequent uploads
-- ============================================================================

CREATE TABLE patient_government_linkage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name TEXT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  government_id TEXT NOT NULL,
  id_type TEXT NOT NULL CHECK (id_type IN ('registration_id', 'program_id')),
  matched_by TEXT NOT NULL CHECK (matched_by IN ('auto_name_date', 'manual')),
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hospital_name, government_id)
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_linkage_hospital ON patient_government_linkage(hospital_name);
CREATE INDEX idx_linkage_patient ON patient_government_linkage(patient_id);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE patient_government_linkage ENABLE ROW LEVEL SECURITY;

-- Users can read their hospital's linkages
CREATE POLICY "Users can read own linkages"
  ON patient_government_linkage
  FOR SELECT
  TO authenticated
  USING (hospital_name = (current_setting('app.current_hospital', true)));

-- Users can insert their hospital's linkages
CREATE POLICY "Users can insert own linkages"
  ON patient_government_linkage
  FOR INSERT
  TO authenticated
  WITH CHECK (hospital_name = (current_setting('app.current_hospital', true)));

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE patient_government_linkage IS 'Stores linkages between government portal IDs and Adamrit patients for automatic matching';
COMMENT ON COLUMN patient_government_linkage.hospital_name IS 'Hospital scope for per-hospital isolation';
COMMENT ON COLUMN patient_government_linkage.government_id IS 'Government portal ID (registration_id or program_id)';
COMMENT ON COLUMN patient_government_linkage.id_type IS 'Type of government ID: registration_id or program_id';
COMMENT ON COLUMN patient_government_linkage.matched_by IS 'How the linkage was created: auto_name_date or manual';
