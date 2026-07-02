-- Add hospital_name column to pharmacy_sales table for multi-hospital support

ALTER TABLE pharmacy_sales
ADD COLUMN IF NOT EXISTS hospital_name VARCHAR(255);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_hospital
ON pharmacy_sales(hospital_name);

-- Add comment
COMMENT ON COLUMN pharmacy_sales.hospital_name IS 'Hospital name for multi-hospital filtering (Ayushman, Hope, etc.)';
