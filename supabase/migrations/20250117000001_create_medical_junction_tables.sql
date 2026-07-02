-- Create junction tables for medical data (Many-to-Many relationships)

-- 2. Visit ESIC Surgeons Junction Table
CREATE TABLE IF NOT EXISTS visit_esic_surgeons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  surgeon_id UUID NOT NULL REFERENCES esic_surgeons(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(visit_id, surgeon_id)
);

-- 3. Visit Referees Junction Table
CREATE TABLE IF NOT EXISTS visit_referees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES referees(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(visit_id, referee_id)
);

-- 4. Visit Hope Surgeons Junction Table
CREATE TABLE IF NOT EXISTS visit_hope_surgeons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  surgeon_id UUID NOT NULL REFERENCES hope_surgeons(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(visit_id, surgeon_id)
);

-- 5. Visit Hope Consultants Junction Table
CREATE TABLE IF NOT EXISTS visit_hope_consultants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES hope_consultants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(visit_id, consultant_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_visit_esic_surgeons_visit_id ON visit_esic_surgeons(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_esic_surgeons_surgeon_id ON visit_esic_surgeons(surgeon_id);

CREATE INDEX IF NOT EXISTS idx_visit_referees_visit_id ON visit_referees(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_referees_referee_id ON visit_referees(referee_id);

CREATE INDEX IF NOT EXISTS idx_visit_hope_surgeons_visit_id ON visit_hope_surgeons(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_hope_surgeons_surgeon_id ON visit_hope_surgeons(surgeon_id);

CREATE INDEX IF NOT EXISTS idx_visit_hope_consultants_visit_id ON visit_hope_consultants(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_hope_consultants_consultant_id ON visit_hope_consultants(consultant_id);

-- Enable Row Level Security (RLS) for all junction tables
ALTER TABLE visit_esic_surgeons ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_referees ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_hope_surgeons ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_hope_consultants ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (allow all operations for authenticated users)
CREATE POLICY "Allow all operations for authenticated users" ON visit_esic_surgeons
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for authenticated users" ON visit_referees
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for authenticated users" ON visit_hope_surgeons
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all operations for authenticated users" ON visit_hope_consultants
  FOR ALL USING (auth.role() = 'authenticated');

-- Add triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_visit_esic_surgeons_updated_at BEFORE UPDATE ON visit_esic_surgeons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_visit_referees_updated_at BEFORE UPDATE ON visit_referees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_visit_hope_surgeons_updated_at BEFORE UPDATE ON visit_hope_surgeons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_visit_hope_consultants_updated_at BEFORE UPDATE ON visit_hope_consultants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE visit_esic_surgeons IS 'Junction table linking visits to ESIC surgeons (many-to-many)';
COMMENT ON TABLE visit_referees IS 'Junction table linking visits to referees (many-to-many)';
COMMENT ON TABLE visit_hope_surgeons IS 'Junction table linking visits to Hope surgeons (many-to-many)';
COMMENT ON TABLE visit_hope_consultants IS 'Junction table linking visits to Hope consultants (many-to-many)'; 