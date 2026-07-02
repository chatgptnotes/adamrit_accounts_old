-- Disconnect medications table from medicine_manufacturers table
-- This removes any foreign key constraints between the two tables

-- Drop foreign key constraint if it exists
ALTER TABLE medications
DROP CONSTRAINT IF EXISTS medications_manufacturer_id_fkey;

ALTER TABLE medications
DROP CONSTRAINT IF EXISTS medications_manufacturer_fkey;

ALTER TABLE medications
DROP CONSTRAINT IF EXISTS fk_medications_medicine_manufacturers;

-- Drop any other potential foreign key constraints to medicine_manufacturers
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'medications'::regclass
        AND confrelid = 'medicine_manufacturers'::regclass
    LOOP
        EXECUTE 'ALTER TABLE medications DROP CONSTRAINT IF EXISTS ' || constraint_record.conname;
    END LOOP;
END $$;

COMMENT ON TABLE medications IS 'Master medications table - disconnected from medicine_manufacturers, will use manufacturer_companies instead';
