-- Fix v_batch_stock_details view to include medicine names and details
-- This resolves the "No Batch Inventory Found" issue in Stock Management

-- Drop existing view
DROP VIEW IF EXISTS v_batch_stock_details CASCADE;

-- Recreate view with proper joins to medication and suppliers tables
CREATE OR REPLACE VIEW v_batch_stock_details AS
SELECT
    -- Batch inventory columns
    mbi.id,
    mbi.medicine_id,
    mbi.batch_number,
    mbi.expiry_date,
    mbi.manufacturing_date,
    mbi.current_stock,
    mbi.received_quantity,
    mbi.sold_quantity,
    mbi.reserved_stock,
    mbi.free_quantity,
    mbi.purchase_price,
    mbi.selling_price,
    mbi.mrp,
    mbi.gst,
    mbi.sgst,
    mbi.cgst,
    mbi.gst_amount,
    mbi.supplier_id,
    mbi.purchase_order_id,
    mbi.grn_number,
    mbi.grn_date,
    mbi.rack_number,
    mbi.shelf_location,
    mbi.hospital_name,
    mbi.is_expired,
    mbi.is_active,
    mbi.created_at,
    mbi.updated_at,

    -- Medication details (joined from medication table)
    COALESCE(m.product_name, m.name) as medicine_name,
    m.generic as generic_name,
    m.manufacturer,
    m.dose_form as dosage_form,
    m.dosage as strength,
    m.item_code,
    m.pack as pack_size,

    -- Supplier details (joined from suppliers table)
    s.name as supplier_name,
    s.contact_person as supplier_contact,
    s.phone as supplier_phone,

    -- Calculated fields for expiry status
    CASE
        WHEN mbi.expiry_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN mbi.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING_SOON'
        WHEN mbi.expiry_date < CURRENT_DATE + INTERVAL '90 days' THEN 'NEAR_EXPIRY'
        ELSE 'GOOD'
    END as expiry_status,

    -- Days until expiry (negative if expired)
    (mbi.expiry_date - CURRENT_DATE) as days_to_expiry,

    -- Stock value
    (mbi.current_stock * mbi.mrp) as stock_value

FROM public.medicine_batch_inventory mbi
LEFT JOIN public.medication m ON mbi.medicine_id = m.id
LEFT JOIN public.suppliers s ON mbi.supplier_id = s.id
WHERE mbi.is_active = TRUE
ORDER BY mbi.expiry_date ASC;

-- Add comment to view
COMMENT ON VIEW v_batch_stock_details IS 'Comprehensive batch-wise stock information with medication details, supplier info, and expiry status calculations';

-- Grant permissions to authenticated users
GRANT SELECT ON v_batch_stock_details TO authenticated;

-- Grant permissions to service role (for backend operations)
GRANT SELECT ON v_batch_stock_details TO service_role;

-- Verify the fix by showing sample data (if any exists)
DO $$
DECLARE
    record_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO record_count FROM v_batch_stock_details;
    RAISE NOTICE 'v_batch_stock_details view recreated successfully. Records found: %', record_count;
END $$;
