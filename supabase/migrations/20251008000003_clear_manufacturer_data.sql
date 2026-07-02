-- Clear manufacturer and manufacturer_company_id data from medications table
-- This will set all values to NULL without dropping the columns

UPDATE medications
SET
    manufacturer = NULL,
    manufacturer_company_id = NULL;

COMMENT ON COLUMN medications.manufacturer IS 'Manufacturer name - to be populated from manufacturer_companies table';
COMMENT ON COLUMN medications.manufacturer_company_id IS 'Foreign key reference to manufacturer_companies table';
