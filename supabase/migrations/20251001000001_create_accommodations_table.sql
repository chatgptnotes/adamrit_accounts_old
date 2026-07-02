-- Create Accommodations table
CREATE TABLE IF NOT EXISTS public.accommodations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_type TEXT NOT NULL,
    private_rate NUMERIC(10, 2),
    nabh_rate NUMERIC(10, 2),
    non_nabh_rate NUMERIC(10, 2),
    tpa_rate NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_accommodations_room_type ON public.accommodations(room_type);

-- Add trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_accommodations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_accommodations_updated_at
    BEFORE UPDATE ON public.accommodations
    FOR EACH ROW
    EXECUTE FUNCTION update_accommodations_updated_at();

-- Enable RLS (Row Level Security)
ALTER TABLE public.accommodations ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Enable read access for all authenticated users" ON public.accommodations
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Enable insert access for all authenticated users" ON public.accommodations
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Enable update access for all authenticated users" ON public.accommodations
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Enable delete access for all authenticated users" ON public.accommodations
    FOR DELETE
    TO authenticated
    USING (true);
