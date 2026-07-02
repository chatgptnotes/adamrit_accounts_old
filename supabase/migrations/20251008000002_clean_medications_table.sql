-- Clean medications table - Remove old columns and keep only pharmacy_items columns
-- This will remove complication_id and other old medical-related columns

-- First, drop the foreign key constraint if exists
ALTER TABLE medications
DROP CONSTRAINT IF EXISTS medications_complication_id_fkey;

-- Remove old columns that are not in pharmacy_items
ALTER TABLE medications
DROP COLUMN IF EXISTS complication_id,
DROP COLUMN IF EXISTS updated_at;

-- Keep only these columns from the original medications table:
-- id (UUID) - we'll keep this as primary key
-- name (text) - matches pharmacy_items.name
-- created_at (timestamp) - we'll keep for audit

-- All other columns are already added from the previous migration:
-- product_name, etc, manufacturer, manufacturer_company_id, item_code, pack, stock,
-- loose_stock, generic, date, minimum, maximum, expiry_date, shelf, supplier_name,
-- supplier_id, is_deleted, create_time, created_by, location_id, dose_form,
-- expensive_product, profit_percentage, gen_ward_discount, spcl_ward_discount,
-- item_type, is_implant

-- Summary of final medications table structure:
-- id (UUID PRIMARY KEY) - Supabase format
-- name (text NOT NULL) - matches pharmacy_items
-- product_name, etc, manufacturer, manufacturer_company_id, item_code, pack, stock,
-- loose_stock, generic, date, minimum, maximum, expiry_date, shelf, supplier_name,
-- supplier_id, is_deleted, create_time, created_by, location_id, dose_form,
-- expensive_product, profit_percentage, gen_ward_discount, spcl_ward_discount,
-- item_type, is_implant
-- created_at (timestamp) - for audit trail

COMMENT ON TABLE medications IS 'Master medications table - shared across all hospitals (Ayushman, Hope, etc.)';
