-- Create advance_payment table
-- Created: 2025-09-24
-- Purpose: Store advance payment data from Advance Payment modal

CREATE TABLE IF NOT EXISTS advance_payment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Patient and Visit Information (fetched from patients and visits tables)
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    visit_id TEXT NOT NULL, -- e.g., 'IH25F27004'
    patient_name TEXT NOT NULL, -- e.g., 'Diya'
    bill_no TEXT, -- e.g., 'BL-IH25F27004'
    patients_id TEXT, -- e.g., 'UHAY25F27002' (from patients.patients_id)
    date_of_admission DATE, -- e.g., '03/06/2025'
    
    -- Payment Information (from form inputs)
    advance_amount DECIMAL(15,2) NOT NULL, -- Amount entered by user
    returned_amount DECIMAL(15,2) DEFAULT 0.00, -- Calculated refunds total
    is_refund BOOLEAN DEFAULT FALSE, -- Checkbox value
    refund_reason TEXT, -- If is_refund is true
    payment_date DATE NOT NULL, -- Selected date
    payment_mode VARCHAR(50) NOT NULL CHECK (payment_mode IN (
        'CASH', 'CHEQUE', 'CARD', 'UPI', 'NEFT', 'RTGS', 'DD', 'ONLINE'
    )), -- Dropdown selection
    reference_number VARCHAR(100), -- For non-cash payments
    remarks TEXT, -- User entered remarks
    
    -- Status and Audit
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED', 'REFUNDED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by TEXT, -- User who created the record
    
    -- Constraints
    CONSTRAINT chk_advance_amount_positive CHECK (advance_amount > 0),
    CONSTRAINT chk_returned_amount_non_negative CHECK (returned_amount >= 0)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_advance_payment_patient ON advance_payment(patient_id);
CREATE INDEX IF NOT EXISTS idx_advance_payment_visit ON advance_payment(visit_id);
CREATE INDEX IF NOT EXISTS idx_advance_payment_date ON advance_payment(payment_date);
CREATE INDEX IF NOT EXISTS idx_advance_payment_status ON advance_payment(status);

-- Enable Row Level Security
ALTER TABLE advance_payment ENABLE ROW LEVEL SECURITY;

-- Create RLS Policy
CREATE POLICY "Allow all operations for authenticated users" ON advance_payment 
FOR ALL USING (auth.role() = 'authenticated');

-- Insert success message
SELECT 'advance_payment table created successfully!' as status;