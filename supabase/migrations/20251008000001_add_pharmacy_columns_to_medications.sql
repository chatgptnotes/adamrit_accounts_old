-- Add pharmacy_items columns to medications table
-- This migration adds all missing columns from pharmacy_items table to medications table

-- Add missing columns
ALTER TABLE medications
ADD COLUMN IF NOT EXISTS product_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS etc VARCHAR(50),
ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100),
ADD COLUMN IF NOT EXISTS manufacturer_company_id INTEGER,
ADD COLUMN IF NOT EXISTS item_code VARCHAR(255),
ADD COLUMN IF NOT EXISTS pack INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS stock DOUBLE PRECISION DEFAULT 0,
ADD COLUMN IF NOT EXISTS loose_stock INTEGER,
ADD COLUMN IF NOT EXISTS generic VARCHAR(255),
ADD COLUMN IF NOT EXISTS date VARCHAR(255),
ADD COLUMN IF NOT EXISTS minimum INTEGER,
ADD COLUMN IF NOT EXISTS maximum INTEGER,
ADD COLUMN IF NOT EXISTS expiry_date VARCHAR(255),
ADD COLUMN IF NOT EXISTS shelf VARCHAR(255),
ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS supplier_id INTEGER,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS create_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS created_by INTEGER,
ADD COLUMN IF NOT EXISTS location_id INTEGER,
ADD COLUMN IF NOT EXISTS dose_form VARCHAR(255),
ADD COLUMN IF NOT EXISTS expensive_product BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS profit_percentage INTEGER,
ADD COLUMN IF NOT EXISTS gen_ward_discount FLOAT,
ADD COLUMN IF NOT EXISTS spcl_ward_discount FLOAT,
ADD COLUMN IF NOT EXISTS item_type VARCHAR(1) DEFAULT '1',
ADD COLUMN IF NOT EXISTS is_implant INTEGER;

-- Add comments
COMMENT ON COLUMN medications.product_name IS 'This is Product Name field for MARG Kanpur';
COMMENT ON COLUMN medications.item_type IS '1 for Medicine and 2 for Stationary';
COMMENT ON COLUMN medications.is_implant IS 'for implant purchase products';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_medications_item_code ON medications(item_code);
CREATE INDEX IF NOT EXISTS idx_medications_manufacturer ON medications(manufacturer);
CREATE INDEX IF NOT EXISTS idx_medications_generic ON medications(generic);
CREATE INDEX IF NOT EXISTS idx_medications_is_deleted ON medications(is_deleted);
CREATE INDEX IF NOT EXISTS idx_medications_stock ON medications(stock);

-- NOTE: medications table is a MASTER table - shared across all hospitals
-- Do NOT add hospital_name column here - keep it common for all hospitals
