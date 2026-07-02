-- Migration: Create Batch-Wise Inventory System
-- Date: 2025-10-29
-- Description: Creates tables for tracking medicines by batch with expiry dates, quantities, and pricing

-- =====================================================
-- 1. MEDICINE BATCH INVENTORY TABLE (Core)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.medicine_batch_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Medicine Reference
    medicine_id UUID NOT NULL,

    -- Batch Details
    batch_number VARCHAR(100) NOT NULL,
    expiry_date DATE NOT NULL,
    manufacturing_date DATE,

    -- Stock Quantities
    received_quantity INTEGER NOT NULL DEFAULT 0,
    current_stock INTEGER NOT NULL DEFAULT 0,
    sold_quantity INTEGER NOT NULL DEFAULT 0,
    reserved_stock INTEGER NOT NULL DEFAULT 0,
    free_quantity INTEGER NOT NULL DEFAULT 0,

    -- Pricing (can vary per batch)
    purchase_price NUMERIC(10, 2),
    selling_price NUMERIC(10, 2),
    mrp NUMERIC(10, 2),

    -- GST Details
    gst NUMERIC(5, 2) DEFAULT 0.00,
    sgst NUMERIC(5, 2) DEFAULT 0.00,
    cgst NUMERIC(5, 2) DEFAULT 0.00,
    gst_amount NUMERIC(10, 2) DEFAULT 0.00,

    -- Purchase Reference
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    grn_number VARCHAR(100),
    grn_date DATE,

    -- Storage Location
    rack_number VARCHAR(50),
    shelf_location VARCHAR(100),

    -- Multi-tenancy
    hospital_name VARCHAR(100),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_expired BOOLEAN DEFAULT FALSE,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,

    -- Constraints
    CONSTRAINT unique_medicine_batch_hospital UNIQUE(medicine_id, batch_number, hospital_name),
    CONSTRAINT check_positive_quantities CHECK (
        received_quantity >= 0 AND
        current_stock >= 0 AND
        sold_quantity >= 0 AND
        reserved_stock >= 0 AND
        free_quantity >= 0
    ),
    CONSTRAINT check_current_stock_valid CHECK (
        current_stock = received_quantity + free_quantity - sold_quantity - reserved_stock
    )
);

-- Indexes for medicine_batch_inventory
CREATE INDEX idx_batch_inventory_medicine_id ON public.medicine_batch_inventory(medicine_id);
CREATE INDEX idx_batch_inventory_batch_number ON public.medicine_batch_inventory(batch_number);
CREATE INDEX idx_batch_inventory_expiry_date ON public.medicine_batch_inventory(expiry_date);
CREATE INDEX idx_batch_inventory_hospital ON public.medicine_batch_inventory(hospital_name);
CREATE INDEX idx_batch_inventory_po_id ON public.medicine_batch_inventory(purchase_order_id);
CREATE INDEX idx_batch_inventory_active_stock ON public.medicine_batch_inventory(medicine_id, is_active)
    WHERE is_active = TRUE AND current_stock > 0;

-- Comment
COMMENT ON TABLE public.medicine_batch_inventory IS 'Stores batch-wise inventory for medicines with separate tracking for each batch number, expiry date, and pricing';

-- Trigger function to auto-update is_expired based on expiry_date
CREATE OR REPLACE FUNCTION update_batch_is_expired()
RETURNS TRIGGER AS $$
BEGIN
    NEW.is_expired = (NEW.expiry_date < CURRENT_DATE);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update is_expired on INSERT and UPDATE
CREATE TRIGGER trigger_update_batch_is_expired
    BEFORE INSERT OR UPDATE OF expiry_date
    ON public.medicine_batch_inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_batch_is_expired();

COMMENT ON FUNCTION update_batch_is_expired IS 'Automatically updates is_expired flag based on expiry_date comparison with current date';

-- =====================================================
-- 2. GOODS RECEIVED NOTES (GRN) TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.goods_received_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- GRN Details
    grn_number VARCHAR(50) UNIQUE NOT NULL,
    grn_date DATE NOT NULL,

    -- Purchase Reference
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    po_number VARCHAR(50),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,

    -- Invoice Details
    invoice_number VARCHAR(100),
    invoice_date DATE,
    invoice_amount NUMERIC(15, 2),

    -- Summary
    total_items INTEGER NOT NULL DEFAULT 0,
    total_quantity_ordered INTEGER NOT NULL DEFAULT 0,
    total_quantity_received INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00,

    -- Status
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VERIFIED', 'POSTED', 'CANCELLED')),

    -- Verification
    verified_by UUID,
    verified_at TIMESTAMPTZ,

    -- Notes
    notes TEXT,
    remarks TEXT,

    -- Multi-tenancy
    hospital_name VARCHAR(100),

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

-- Indexes for goods_received_notes
CREATE INDEX idx_grn_number ON public.goods_received_notes(grn_number);
CREATE INDEX idx_grn_po_id ON public.goods_received_notes(purchase_order_id);
CREATE INDEX idx_grn_date ON public.goods_received_notes(grn_date DESC);
CREATE INDEX idx_grn_status ON public.goods_received_notes(status);
CREATE INDEX idx_grn_hospital ON public.goods_received_notes(hospital_name);

COMMENT ON TABLE public.goods_received_notes IS 'Records goods received from suppliers against purchase orders';

-- =====================================================
-- 3. GRN ITEMS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.grn_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- GRN Reference
    grn_id UUID NOT NULL REFERENCES goods_received_notes(id) ON DELETE CASCADE,

    -- Purchase Order Reference
    purchase_order_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,

    -- Medicine Reference
    medicine_id UUID NOT NULL,
    product_name TEXT NOT NULL,
    manufacturer TEXT,
    pack VARCHAR(50),

    -- Batch Details
    batch_number VARCHAR(100) NOT NULL,
    expiry_date DATE NOT NULL,
    manufacturing_date DATE,

    -- Quantities
    ordered_quantity INTEGER NOT NULL DEFAULT 0,
    received_quantity INTEGER NOT NULL DEFAULT 0,
    accepted_quantity INTEGER,
    rejected_quantity INTEGER DEFAULT 0,
    free_quantity INTEGER DEFAULT 0,

    -- Pricing
    purchase_price NUMERIC(10, 2) NOT NULL,
    sale_price NUMERIC(10, 2),
    mrp NUMERIC(10, 2),

    -- Tax Details
    gst NUMERIC(5, 2) DEFAULT 0.00,
    sgst NUMERIC(5, 2) DEFAULT 0.00,
    cgst NUMERIC(5, 2) DEFAULT 0.00,
    tax_amount NUMERIC(10, 2) DEFAULT 0.00,

    -- Amount
    amount NUMERIC(15, 2),

    -- Storage Location
    rack_number VARCHAR(50),
    shelf_location VARCHAR(100),

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT check_received_quantities CHECK (
        received_quantity >= 0 AND
        rejected_quantity >= 0 AND
        free_quantity >= 0 AND
        accepted_quantity = received_quantity - rejected_quantity
    )
);

-- Indexes for grn_items
CREATE INDEX idx_grn_items_grn_id ON public.grn_items(grn_id);
CREATE INDEX idx_grn_items_po_item_id ON public.grn_items(purchase_order_item_id);
CREATE INDEX idx_grn_items_medicine_id ON public.grn_items(medicine_id);
CREATE INDEX idx_grn_items_batch ON public.grn_items(batch_number);

COMMENT ON TABLE public.grn_items IS 'Line items of goods received notes with batch-wise details';

-- =====================================================
-- 4. BATCH STOCK MOVEMENTS TABLE (Audit Trail)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.batch_stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Batch Reference
    batch_inventory_id UUID NOT NULL REFERENCES medicine_batch_inventory(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL,
    batch_number VARCHAR(100) NOT NULL,

    -- Movement Details
    movement_type VARCHAR(20) NOT NULL CHECK (
        movement_type IN ('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER', 'DAMAGE', 'EXPIRY', 'RETURN')
    ),

    -- Reference
    reference_type VARCHAR(30), -- 'SALE', 'PURCHASE', 'GRN', 'ADJUSTMENT', 'OPENING_STOCK'
    reference_id UUID,
    reference_number VARCHAR(100),

    -- Quantities
    quantity_before INTEGER NOT NULL,
    quantity_changed INTEGER NOT NULL, -- Positive for IN, Negative for OUT
    quantity_after INTEGER NOT NULL,

    -- Details
    reason TEXT,
    remarks TEXT,

    -- Audit
    movement_date TIMESTAMPTZ DEFAULT NOW(),
    performed_by UUID,
    hospital_name VARCHAR(100),

    -- Constraints
    CONSTRAINT check_quantity_calculation CHECK (
        quantity_after = quantity_before + quantity_changed
    )
);

-- Indexes for batch_stock_movements
CREATE INDEX idx_stock_movement_batch_id ON public.batch_stock_movements(batch_inventory_id);
CREATE INDEX idx_stock_movement_medicine_id ON public.batch_stock_movements(medicine_id);
CREATE INDEX idx_stock_movement_type ON public.batch_stock_movements(movement_type);
CREATE INDEX idx_stock_movement_date ON public.batch_stock_movements(movement_date DESC);
CREATE INDEX idx_stock_movement_reference ON public.batch_stock_movements(reference_type, reference_id);

COMMENT ON TABLE public.batch_stock_movements IS 'Audit trail for all stock movements at batch level';

-- =====================================================
-- 5. ADD MISSING COLUMNS TO EXISTING TABLES
-- =====================================================

-- Add missing columns to purchase_order_items
DO $$
BEGIN
    -- Add expiry_date if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_order_items'
                   AND column_name = 'expiry_date') THEN
        ALTER TABLE public.purchase_order_items
        ADD COLUMN expiry_date DATE;
    END IF;

    -- Add free_quantity if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_order_items'
                   AND column_name = 'free_quantity') THEN
        ALTER TABLE public.purchase_order_items
        ADD COLUMN free_quantity INTEGER DEFAULT 0;
    END IF;

    -- Add gst if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_order_items'
                   AND column_name = 'gst') THEN
        ALTER TABLE public.purchase_order_items
        ADD COLUMN gst NUMERIC(5, 2) DEFAULT 0.00;
    END IF;

    -- Add sgst if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_order_items'
                   AND column_name = 'sgst') THEN
        ALTER TABLE public.purchase_order_items
        ADD COLUMN sgst NUMERIC(5, 2) DEFAULT 0.00;
    END IF;

    -- Add cgst if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_order_items'
                   AND column_name = 'cgst') THEN
        ALTER TABLE public.purchase_order_items
        ADD COLUMN cgst NUMERIC(5, 2) DEFAULT 0.00;
    END IF;

    -- Add gst_amount if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_order_items'
                   AND column_name = 'gst_amount') THEN
        ALTER TABLE public.purchase_order_items
        ADD COLUMN gst_amount NUMERIC(10, 2) DEFAULT 0.00;
    END IF;
END $$;

-- Add batch tracking to pharmacy_sale_items
DO $$
BEGIN
    -- Add batch_inventory_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'pharmacy_sale_items'
                   AND column_name = 'batch_inventory_id') THEN
        ALTER TABLE public.pharmacy_sale_items
        ADD COLUMN batch_inventory_id UUID REFERENCES medicine_batch_inventory(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Create index on batch_inventory_id
CREATE INDEX IF NOT EXISTS idx_sale_items_batch_inventory ON public.pharmacy_sale_items(batch_inventory_id);

-- =====================================================
-- 6. TRIGGERS FOR AUTO-UPDATES
-- =====================================================

-- Trigger: Update updated_at timestamp for medicine_batch_inventory
CREATE OR REPLACE FUNCTION update_batch_inventory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_batch_inventory_updated_at
    BEFORE UPDATE ON public.medicine_batch_inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_batch_inventory_updated_at();

-- Trigger: Update updated_at timestamp for goods_received_notes
CREATE TRIGGER trigger_grn_updated_at
    BEFORE UPDATE ON public.goods_received_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Auto-create stock movement record on batch inventory changes
CREATE OR REPLACE FUNCTION log_batch_stock_movement()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if stock quantity changed
    IF (TG_OP = 'UPDATE' AND OLD.current_stock != NEW.current_stock) THEN
        INSERT INTO public.batch_stock_movements (
            batch_inventory_id,
            medicine_id,
            batch_number,
            movement_type,
            quantity_before,
            quantity_changed,
            quantity_after,
            reason,
            hospital_name
        ) VALUES (
            NEW.id,
            NEW.medicine_id,
            NEW.batch_number,
            CASE
                WHEN NEW.current_stock > OLD.current_stock THEN 'IN'
                WHEN NEW.current_stock < OLD.current_stock THEN 'OUT'
            END,
            OLD.current_stock,
            NEW.current_stock - OLD.current_stock,
            NEW.current_stock,
            'Auto-logged stock change',
            NEW.hospital_name
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_stock_movement
    AFTER UPDATE ON public.medicine_batch_inventory
    FOR EACH ROW
    EXECUTE FUNCTION log_batch_stock_movement();

-- =====================================================
-- 7. VIEWS FOR REPORTING
-- =====================================================

-- View: Combined Stock (Total per Medicine)
CREATE OR REPLACE VIEW v_medicine_combined_stock AS
SELECT
    mbi.medicine_id,
    mbi.hospital_name,
    SUM(mbi.current_stock) as total_stock,
    SUM(mbi.received_quantity) as total_received,
    SUM(mbi.sold_quantity) as total_sold,
    COUNT(DISTINCT mbi.batch_number) as batch_count,
    MIN(mbi.expiry_date) as nearest_expiry,
    COUNT(*) FILTER (WHERE mbi.expiry_date < CURRENT_DATE + INTERVAL '90 days') as near_expiry_batches
FROM public.medicine_batch_inventory mbi
WHERE mbi.is_active = TRUE
GROUP BY mbi.medicine_id, mbi.hospital_name;

COMMENT ON VIEW v_medicine_combined_stock IS 'Aggregated stock view showing total quantities across all batches per medicine';

-- View: Batch-wise Stock Details
CREATE OR REPLACE VIEW v_batch_stock_details AS
SELECT
    mbi.id,
    mbi.medicine_id,
    mbi.batch_number,
    mbi.expiry_date,
    mbi.current_stock,
    mbi.received_quantity,
    mbi.sold_quantity,
    mbi.free_quantity,
    mbi.purchase_price,
    mbi.selling_price,
    mbi.mrp,
    mbi.grn_number,
    mbi.grn_date,
    mbi.rack_number,
    mbi.shelf_location,
    mbi.hospital_name,
    mbi.is_expired,
    CASE
        WHEN mbi.expiry_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN mbi.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING_SOON'
        WHEN mbi.expiry_date < CURRENT_DATE + INTERVAL '90 days' THEN 'NEAR_EXPIRY'
        ELSE 'GOOD'
    END as expiry_status,
    (mbi.expiry_date - CURRENT_DATE) as days_to_expiry
FROM public.medicine_batch_inventory mbi
WHERE mbi.is_active = TRUE
ORDER BY mbi.expiry_date ASC;

COMMENT ON VIEW v_batch_stock_details IS 'Detailed batch-wise stock information with expiry status';

-- =====================================================
-- 8. HELPER FUNCTIONS
-- =====================================================

-- Function: Get available batches for a medicine
CREATE OR REPLACE FUNCTION get_available_batches(
    p_medicine_id UUID,
    p_hospital_name VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    batch_id UUID,
    batch_number VARCHAR,
    expiry_date DATE,
    available_stock INTEGER,
    mrp NUMERIC,
    selling_price NUMERIC,
    days_to_expiry INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mbi.id,
        mbi.batch_number,
        mbi.expiry_date,
        mbi.current_stock,
        mbi.mrp,
        mbi.selling_price,
        (mbi.expiry_date - CURRENT_DATE)
    FROM public.medicine_batch_inventory mbi
    WHERE mbi.medicine_id = p_medicine_id
        AND mbi.is_active = TRUE
        AND mbi.current_stock > 0
        AND mbi.expiry_date > CURRENT_DATE
        AND (p_hospital_name IS NULL OR mbi.hospital_name = p_hospital_name)
    ORDER BY mbi.expiry_date ASC; -- FEFO (First Expiry First Out)
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_available_batches IS 'Returns available batches for a medicine sorted by expiry date (FEFO)';

-- =====================================================
-- HELPER FUNCTION: UPDATE EXPIRED STATUSES
-- =====================================================

-- Function to manually update is_expired for all batches
-- Can be called periodically (e.g., daily via cron or scheduled job)
CREATE OR REPLACE FUNCTION update_all_expired_batches()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.medicine_batch_inventory
    SET is_expired = (expiry_date < CURRENT_DATE)
    WHERE is_expired != (expiry_date < CURRENT_DATE);

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_all_expired_batches IS 'Manually updates is_expired flag for all batches. Returns count of updated records.';

-- Optional: Uncomment to enable daily auto-update via pg_cron extension
-- Requires pg_cron extension to be enabled in your Supabase project
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- SELECT cron.schedule(
--     'update-expired-batches-daily',
--     '0 0 * * *',  -- Run daily at midnight UTC
--     $$SELECT update_all_expired_batches();$$
-- );

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
