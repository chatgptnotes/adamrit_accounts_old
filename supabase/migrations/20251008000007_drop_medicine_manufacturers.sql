-- Drop medicine_manufacturers table
-- This table is being replaced by manufacturer_companies table

-- Drop the table and all its dependencies
DROP TABLE IF EXISTS medicine_manufacturers CASCADE;

-- Note: CASCADE will automatically drop any dependent objects (foreign keys, indexes, etc.)
