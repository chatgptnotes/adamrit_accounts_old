-- Create manufacturer_companies table
-- Simple table with id (auto-increment) and name

CREATE TABLE IF NOT EXISTS manufacturer_companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster search
CREATE INDEX IF NOT EXISTS idx_manufacturer_companies_name ON manufacturer_companies(name);

-- Add comment
COMMENT ON TABLE manufacturer_companies IS 'Master table for manufacturer/company names';

-- Add some sample data (optional)
INSERT INTO manufacturer_companies (name) VALUES
('Cipla'),
('Sun Pharma'),
('Dr. Reddy''s Laboratories'),
('Lupin'),
('Zydus Cadila'),
('Mankind Pharma'),
('Alkem Laboratories'),
('Torrent Pharmaceuticals'),
('Glenmark Pharmaceuticals'),
('Abbott India')
ON CONFLICT DO NOTHING;
