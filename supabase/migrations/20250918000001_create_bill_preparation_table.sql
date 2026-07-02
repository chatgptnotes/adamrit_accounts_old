-- Create bill_preparation table for Supabase
-- This table stores billing preparation and submission data for visits

CREATE TABLE IF NOT EXISTS public.bill_preparation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id TEXT NOT NULL REFERENCES public.visits(visit_id) ON DELETE CASCADE,

    -- Bill Preparation fields
    date_of_bill_preparation DATE,
    bill_amount DECIMAL(15,2),
    expected_amount DECIMAL(15,2),
    billing_executive TEXT,
    reason_for_delay TEXT,

    -- Bill Submission fields
    date_of_submission DATE,
    executive_who_submitted TEXT,

    -- Received Amount fields
    received_date DATE,
    received_amount DECIMAL(15,2),
    deduction_amount DECIMAL(15,2),
    reason_for_deduction TEXT,

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,

    -- Constraints
    CONSTRAINT bill_preparation_visit_unique UNIQUE(visit_id)
);

-- Add table comment
COMMENT ON TABLE public.bill_preparation IS 'Stores billing preparation and submission data for visits';

-- Add column comments
COMMENT ON COLUMN public.bill_preparation.visit_id IS 'Foreign key reference to visits table';
COMMENT ON COLUMN public.bill_preparation.date_of_bill_preparation IS 'Date when bill preparation was started';
COMMENT ON COLUMN public.bill_preparation.bill_amount IS 'Actual bill amount';
COMMENT ON COLUMN public.bill_preparation.expected_amount IS 'Expected amount for the bill';
COMMENT ON COLUMN public.bill_preparation.billing_executive IS 'Name of the billing executive responsible';
COMMENT ON COLUMN public.bill_preparation.reason_for_delay IS 'Reason for any delays in bill preparation';
COMMENT ON COLUMN public.bill_preparation.date_of_submission IS 'Date when bill was submitted';
COMMENT ON COLUMN public.bill_preparation.executive_who_submitted IS 'Name of executive who submitted the bill';
COMMENT ON COLUMN public.bill_preparation.received_date IS 'Date when payment was received';
COMMENT ON COLUMN public.bill_preparation.received_amount IS 'Amount that was actually received';
COMMENT ON COLUMN public.bill_preparation.deduction_amount IS 'Amount that was deducted from payment';
COMMENT ON COLUMN public.bill_preparation.reason_for_deduction IS 'Reason for any deductions made';

-- Enable Row Level Security
ALTER TABLE public.bill_preparation ENABLE ROW LEVEL SECURITY;

-- RLS Policy for SELECT
CREATE POLICY "bill_preparation_select_policy" ON public.bill_preparation
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.visits v
            INNER JOIN public.patients p ON v.patient_id = p.id
            WHERE v.visit_id = bill_preparation.visit_id
            AND p.hospital_name = current_setting('app.hospital_name', true)
        )
    );

-- RLS Policy for INSERT
CREATE POLICY "bill_preparation_insert_policy" ON public.bill_preparation
    FOR INSERT WITH CHECK (true);

-- RLS Policy for UPDATE
CREATE POLICY "bill_preparation_update_policy" ON public.bill_preparation
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.visits v
            INNER JOIN public.patients p ON v.patient_id = p.id
            WHERE v.visit_id = bill_preparation.visit_id
            AND p.hospital_name = current_setting('app.hospital_name', true)
        )
    );

-- RLS Policy for DELETE
CREATE POLICY "bill_preparation_delete_policy" ON public.bill_preparation
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.visits v
            INNER JOIN public.patients p ON v.patient_id = p.id
            WHERE v.visit_id = bill_preparation.visit_id
            AND p.hospital_name = current_setting('app.hospital_name', true)
        )
    );

-- Create indexes for better performance
CREATE INDEX idx_bill_preparation_visit_id ON public.bill_preparation(visit_id);
CREATE INDEX idx_bill_preparation_billing_executive ON public.bill_preparation(billing_executive);
CREATE INDEX idx_bill_preparation_date_of_bill_preparation ON public.bill_preparation(date_of_bill_preparation);
CREATE INDEX idx_bill_preparation_date_of_submission ON public.bill_preparation(date_of_submission);
CREATE INDEX idx_bill_preparation_received_date ON public.bill_preparation(received_date);

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
CREATE TRIGGER update_bill_preparation_updated_at
    BEFORE UPDATE ON public.bill_preparation
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON public.bill_preparation TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO authenticated;