-- =====================================================
-- Create visit_implants table
-- Links implants from master table to patient visits
-- =====================================================

-- Create visit_implants table
CREATE TABLE IF NOT EXISTS visit_implants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Foreign Key to visits table (UUID)
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,

    -- Foreign Key to implants master table
    implant_id UUID NOT NULL REFERENCES implants(id) ON DELETE RESTRICT,

    -- Implant details (copied at time of adding for record keeping)
    implant_name TEXT NOT NULL,

    -- Quantity
    quantity INTEGER NOT NULL DEFAULT 1,

    -- Rate (selected based on patient category)
    rate DECIMAL(12,2) NOT NULL DEFAULT 0,

    -- Total amount (quantity * rate)
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,

    -- Which rate was used (for audit)
    rate_type TEXT CHECK (rate_type IN ('nabh_nabl', 'non_nabh_nabl', 'private', 'bhopal_nabh', 'bhopal_non_nabh')),

    -- Additional fields
    remarks TEXT,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled')),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_visit_implants_visit_id ON visit_implants(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_implants_implant_id ON visit_implants(implant_id);
CREATE INDEX IF NOT EXISTS idx_visit_implants_status ON visit_implants(status);

-- Enable Row Level Security
ALTER TABLE visit_implants ENABLE ROW LEVEL SECURITY;

-- RLS Policy - Allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON visit_implants
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Trigger function for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_visit_implants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_visit_implants_updated_at ON visit_implants;
CREATE TRIGGER trigger_visit_implants_updated_at
    BEFORE UPDATE ON visit_implants
    FOR EACH ROW
    EXECUTE FUNCTION update_visit_implants_updated_at();

-- =====================================================
-- Comments for documentation
-- =====================================================
COMMENT ON TABLE visit_implants IS 'Junction table linking implants to patient visits';
COMMENT ON COLUMN visit_implants.visit_id IS 'Foreign key to visits table';
COMMENT ON COLUMN visit_implants.implant_id IS 'Foreign key to implants master table';
COMMENT ON COLUMN visit_implants.implant_name IS 'Implant name copied at time of adding (for historical record)';
COMMENT ON COLUMN visit_implants.quantity IS 'Number of implants used';
COMMENT ON COLUMN visit_implants.rate IS 'Rate per unit based on patient category';
COMMENT ON COLUMN visit_implants.amount IS 'Total amount (quantity * rate)';
COMMENT ON COLUMN visit_implants.rate_type IS 'Which rate category was applied';
