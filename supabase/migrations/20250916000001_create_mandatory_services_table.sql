-- Create mandatory_services table
CREATE TABLE IF NOT EXISTS public.mandatory_services (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    tpa_rate DECIMAL(10,2),
    private_rate DECIMAL(10,2),
    cghs_rate DECIMAL(10,2),
    non_cghs_rate DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    hospital_name VARCHAR(255)
);

-- Create RLS (Row Level Security) policies
ALTER TABLE public.mandatory_services ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users to select mandatory services
CREATE POLICY "Users can view mandatory services" ON public.mandatory_services
    FOR SELECT USING (auth.role() = 'authenticated');

-- Policy for authenticated users to insert mandatory services
CREATE POLICY "Users can insert mandatory services" ON public.mandatory_services
    FOR INSERT WITH CHECK (
        auth.role() = 'authenticated' AND 
        auth.uid() = created_by
    );

-- Policy for authenticated users to update their own mandatory services
CREATE POLICY "Users can update their own mandatory services" ON public.mandatory_services
    FOR UPDATE USING (
        auth.role() = 'authenticated' AND 
        auth.uid() = created_by
    );

-- Policy for authenticated users to delete their own mandatory services
CREATE POLICY "Users can delete their own mandatory services" ON public.mandatory_services
    FOR DELETE USING (
        auth.role() = 'authenticated' AND 
        auth.uid() = created_by
    );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_mandatory_services_service_name ON public.mandatory_services(service_name);
CREATE INDEX IF NOT EXISTS idx_mandatory_services_status ON public.mandatory_services(status);
CREATE INDEX IF NOT EXISTS idx_mandatory_services_hospital_name ON public.mandatory_services(hospital_name);
CREATE INDEX IF NOT EXISTS idx_mandatory_services_created_by ON public.mandatory_services(created_by);
CREATE INDEX IF NOT EXISTS idx_mandatory_services_created_at ON public.mandatory_services(created_at);

-- Create trigger to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_mandatory_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_mandatory_services_updated_at
    BEFORE UPDATE ON public.mandatory_services
    FOR EACH ROW
    EXECUTE FUNCTION update_mandatory_services_updated_at();

-- Insert sample data
INSERT INTO public.mandatory_services (service_name, tpa_rate, private_rate, cghs_rate, non_cghs_rate, status, hospital_name) VALUES
('Emergency Department', 5000.00, 8000.00, 4500.00, 6500.00, 'Active', 'ESIC Ayushman Hope'),
('ICU Night Shift', 12000.00, 15000.00, 10000.00, 13000.00, 'Active', 'ESIC Ayushman Hope'),
('Rural Health Program', 3000.00, 4500.00, 2500.00, 3800.00, 'Completed', 'ESIC Ayushman Hope'),
('Pediatric Ward Coverage', 7000.00, 9500.00, 6000.00, 8200.00, 'Active', 'ESIC Ayushman Hope'),
('Surgical Suite Coverage', 15000.00, 20000.00, 12000.00, 17000.00, 'Active', 'ESIC Ayushman Hope'),
('Maternity Ward', 8000.00, 12000.00, 7000.00, 10000.00, 'Active', 'ESIC Ayushman Hope'),
('General Medicine', 4000.00, 6000.00, 3500.00, 5000.00, 'Active', 'ESIC Ayushman Hope'),
('Orthopedic Department', 10000.00, 14000.00, 8500.00, 12000.00, 'Active', 'ESIC Ayushman Hope');

-- Grant permissions
GRANT ALL ON public.mandatory_services TO authenticated;
GRANT ALL ON public.mandatory_services TO service_role;

-- Add comments for documentation
COMMENT ON TABLE public.mandatory_services IS 'Table to store mandatory service information with different rate structures';
COMMENT ON COLUMN public.mandatory_services.id IS 'Unique identifier for mandatory service';
COMMENT ON COLUMN public.mandatory_services.service_name IS 'Name of the mandatory service';
COMMENT ON COLUMN public.mandatory_services.tpa_rate IS 'Rate for TPA (Third Party Administrator) payments';
COMMENT ON COLUMN public.mandatory_services.private_rate IS 'Rate for private payments';
COMMENT ON COLUMN public.mandatory_services.cghs_rate IS 'Rate for CGHS (Central Government Health Scheme) payments';
COMMENT ON COLUMN public.mandatory_services.non_cghs_rate IS 'Rate for non-CGHS payments';
COMMENT ON COLUMN public.mandatory_services.status IS 'Status of the service (Active, Inactive, Completed)';
COMMENT ON COLUMN public.mandatory_services.created_at IS 'Timestamp when record was created';
COMMENT ON COLUMN public.mandatory_services.updated_at IS 'Timestamp when record was last updated';
COMMENT ON COLUMN public.mandatory_services.created_by IS 'User who created this record';
COMMENT ON COLUMN public.mandatory_services.hospital_name IS 'Name of the hospital this service belongs to';