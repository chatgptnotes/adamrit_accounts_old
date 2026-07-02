-- Connect medications table to manufacturer_companies table
-- Add foreign key constraint on manufacturer_company_id column

-- First ensure manufacturer_company_id column exists (should already exist from previous migration)
ALTER TABLE medication
ADD COLUMN IF NOT EXISTS manufacturer_company_id INTEGER;

-- Add foreign key constraint to manufacturer_companies table
ALTER TABLE medication
ADD CONSTRAINT fk_medication_manufacturer_company
FOREIGN KEY (manufacturer_company_id)
REFERENCES manufacturer_companies(id)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_medication_manufacturer_company_id
ON medication(manufacturer_company_id);

-- Add comment
COMMENT ON COLUMN medication.manufacturer_company_id IS 'Foreign key reference to manufacturer_companies.id';
