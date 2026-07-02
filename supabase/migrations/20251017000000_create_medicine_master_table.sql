-- Create medicine_master table for pharmacy inventory management
-- This is the master table for all medicines/pharmacy items

CREATE TABLE IF NOT EXISTS public.medicine_master (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    medicine_name TEXT NOT NULL,
    generic_name TEXT,
    manufacturer_id INTEGER REFERENCES public.manufacturer_companies(id) ON DELETE SET NULL,
    supplier_id INTEGER, -- Will be linked to supplier table when created in future
    quantity INTEGER DEFAULT 0,
    tablets_pieces INTEGER DEFAULT 0,
    batch_number TEXT,
    type VARCHAR(50),
    purchase_price DECIMAL(10,2) DEFAULT 0.00,
    selling_price DECIMAL(10,2) DEFAULT 0.00,
    mrp_price DECIMAL(10,2) DEFAULT 0.00,
    expiry_date DATE,
    hospital_name VARCHAR(100),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_medicine_master_medicine_name ON public.medicine_master(medicine_name);
CREATE INDEX IF NOT EXISTS idx_medicine_master_generic_name ON public.medicine_master(generic_name);
CREATE INDEX IF NOT EXISTS idx_medicine_master_manufacturer_id ON public.medicine_master(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_medicine_master_supplier_id ON public.medicine_master(supplier_id);
CREATE INDEX IF NOT EXISTS idx_medicine_master_batch_number ON public.medicine_master(batch_number);
CREATE INDEX IF NOT EXISTS idx_medicine_master_type ON public.medicine_master(type);
CREATE INDEX IF NOT EXISTS idx_medicine_master_expiry_date ON public.medicine_master(expiry_date);
CREATE INDEX IF NOT EXISTS idx_medicine_master_hospital_name ON public.medicine_master(hospital_name);
CREATE INDEX IF NOT EXISTS idx_medicine_master_is_deleted ON public.medicine_master(is_deleted);

-- Enable Row Level Security
ALTER TABLE public.medicine_master ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view medicine_master" ON public.medicine_master
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert medicine_master" ON public.medicine_master
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update medicine_master" ON public.medicine_master
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can delete medicine_master" ON public.medicine_master
  FOR DELETE TO authenticated USING (true);

-- Add trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_medicine_master_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_medicine_master_updated_at
  BEFORE UPDATE ON public.medicine_master
  FOR EACH ROW
  EXECUTE FUNCTION update_medicine_master_updated_at();

-- Add comments for documentation
COMMENT ON TABLE public.medicine_master IS 'Master table for medicine/pharmacy inventory management';
COMMENT ON COLUMN public.medicine_master.medicine_name IS 'Name of the medicine';
COMMENT ON COLUMN public.medicine_master.generic_name IS 'Generic/scientific name of the medicine';
COMMENT ON COLUMN public.medicine_master.manufacturer_id IS 'Reference to manufacturer_companies table';
COMMENT ON COLUMN public.medicine_master.supplier_id IS 'Supplier ID - will be linked to supplier table when created in future';
COMMENT ON COLUMN public.medicine_master.quantity IS 'Total quantity in stock';
COMMENT ON COLUMN public.medicine_master.tablets_pieces IS 'Number of tablets/pieces per unit';
COMMENT ON COLUMN public.medicine_master.batch_number IS 'Batch/lot number from manufacturer';
COMMENT ON COLUMN public.medicine_master.type IS 'Type of medicine - Injection, Vial, Syrup, Syringe';
COMMENT ON COLUMN public.medicine_master.purchase_price IS 'Price at which medicine was purchased';
COMMENT ON COLUMN public.medicine_master.selling_price IS 'Price at which medicine is sold';
COMMENT ON COLUMN public.medicine_master.mrp_price IS 'Maximum Retail Price';
COMMENT ON COLUMN public.medicine_master.expiry_date IS 'Expiry date of the medicine batch';
COMMENT ON COLUMN public.medicine_master.hospital_name IS 'Hospital name for multi-hospital support';
COMMENT ON COLUMN public.medicine_master.is_deleted IS 'Soft delete flag';
