-- Migration: Create IPD Discharge Summary Tables
-- Created: 2025-09-27
-- Description: Creates comprehensive tables for storing IPD discharge summary data

-- 1. Main discharge summaries table
CREATE TABLE IF NOT EXISTS discharge_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id VARCHAR(50) UNIQUE NOT NULL,
    visit_uuid UUID REFERENCES visits(id) ON DELETE CASCADE,

    -- Patient Information
    patient_name VARCHAR(255),
    reg_id VARCHAR(50),
    address TEXT,
    age_sex VARCHAR(50),
    treating_consultant VARCHAR(255),
    doa DATE, -- Date of Admission
    other_consultants VARCHAR(255),
    date_of_discharge DATE,
    reason_of_discharge VARCHAR(255),
    corporate_type VARCHAR(255),

    -- Medical Information
    diagnosis TEXT,
    investigations TEXT,
    stay_notes TEXT,

    -- Treatment Information
    treatment_condition VARCHAR(100) DEFAULT 'Satisfactory',
    treatment_status VARCHAR(100) DEFAULT 'Stable',
    review_date DATE,
    resident_on_discharge VARCHAR(255),
    enable_sms_alert BOOLEAN DEFAULT false,
    other_consultants_text TEXT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- 2. Discharge medications table
CREATE TABLE IF NOT EXISTS discharge_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discharge_summary_id UUID NOT NULL REFERENCES discharge_summaries(id) ON DELETE CASCADE,

    -- Medication Details
    medication_name VARCHAR(255) NOT NULL,
    unit VARCHAR(50), -- Tab, Cap, Syrup, etc.
    remark TEXT,
    route VARCHAR(50), -- PO, IV, IM, etc.
    dose VARCHAR(50), -- BD, TID, QID, etc.
    quantity VARCHAR(50),
    days VARCHAR(10),
    start_date DATE,

    -- Timing
    timing_morning BOOLEAN DEFAULT false,
    timing_afternoon BOOLEAN DEFAULT false,
    timing_evening BOOLEAN DEFAULT false,
    timing_night BOOLEAN DEFAULT false,
    is_sos BOOLEAN DEFAULT false,

    -- Order
    medication_order INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Discharge examinations table
CREATE TABLE IF NOT EXISTS discharge_examinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discharge_summary_id UUID NOT NULL REFERENCES discharge_summaries(id) ON DELETE CASCADE,

    -- Vital Signs
    temperature VARCHAR(20),
    pulse_rate VARCHAR(20),
    respiratory_rate VARCHAR(20),
    blood_pressure VARCHAR(30),
    spo2 VARCHAR(10),

    -- Examination Details
    examination_details TEXT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Discharge surgery details table
CREATE TABLE IF NOT EXISTS discharge_surgery_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discharge_summary_id UUID NOT NULL REFERENCES discharge_summaries(id) ON DELETE CASCADE,

    -- Surgery Information
    surgery_date TIMESTAMP WITH TIME ZONE,
    procedure_performed VARCHAR(500),
    surgeon VARCHAR(255),
    anesthetist VARCHAR(255),
    anesthesia_type VARCHAR(100),
    implant VARCHAR(255),
    surgery_description TEXT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_discharge_summaries_visit_id ON discharge_summaries(visit_id);
CREATE INDEX IF NOT EXISTS idx_discharge_summaries_visit_uuid ON discharge_summaries(visit_uuid);
CREATE INDEX IF NOT EXISTS idx_discharge_summaries_created_at ON discharge_summaries(created_at);
CREATE INDEX IF NOT EXISTS idx_discharge_medications_summary_id ON discharge_medications(discharge_summary_id);
CREATE INDEX IF NOT EXISTS idx_discharge_medications_order ON discharge_medications(medication_order);
CREATE INDEX IF NOT EXISTS idx_discharge_examinations_summary_id ON discharge_examinations(discharge_summary_id);
CREATE INDEX IF NOT EXISTS idx_discharge_surgery_summary_id ON discharge_surgery_details(discharge_summary_id);

-- 6. Create Row Level Security (RLS) policies
ALTER TABLE discharge_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_examinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_surgery_details ENABLE ROW LEVEL SECURITY;

-- RLS Policies for discharge_summaries
CREATE POLICY "Users can view all discharge summaries"
ON discharge_summaries FOR SELECT
USING (true);

CREATE POLICY "Users can insert discharge summaries"
ON discharge_summaries FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update discharge summaries"
ON discharge_summaries FOR UPDATE
USING (true);

CREATE POLICY "Users can delete discharge summaries"
ON discharge_summaries FOR DELETE
USING (true);

-- RLS Policies for discharge_medications
CREATE POLICY "Users can view all discharge medications"
ON discharge_medications FOR SELECT
USING (true);

CREATE POLICY "Users can insert discharge medications"
ON discharge_medications FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update discharge medications"
ON discharge_medications FOR UPDATE
USING (true);

CREATE POLICY "Users can delete discharge medications"
ON discharge_medications FOR DELETE
USING (true);

-- RLS Policies for discharge_examinations
CREATE POLICY "Users can view all discharge examinations"
ON discharge_examinations FOR SELECT
USING (true);

CREATE POLICY "Users can insert discharge examinations"
ON discharge_examinations FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update discharge examinations"
ON discharge_examinations FOR UPDATE
USING (true);

CREATE POLICY "Users can delete discharge examinations"
ON discharge_examinations FOR DELETE
USING (true);

-- RLS Policies for discharge_surgery_details
CREATE POLICY "Users can view all discharge surgery details"
ON discharge_surgery_details FOR SELECT
USING (true);

CREATE POLICY "Users can insert discharge surgery details"
ON discharge_surgery_details FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can update discharge surgery details"
ON discharge_surgery_details FOR UPDATE
USING (true);

CREATE POLICY "Users can delete discharge surgery details"
ON discharge_surgery_details FOR DELETE
USING (true);

-- 7. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 8. Create triggers for updated_at
CREATE TRIGGER update_discharge_summaries_updated_at
    BEFORE UPDATE ON discharge_summaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_discharge_medications_updated_at
    BEFORE UPDATE ON discharge_medications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Add comments to tables
COMMENT ON TABLE discharge_summaries IS 'Main table for storing IPD discharge summary information';
COMMENT ON TABLE discharge_medications IS 'Medications prescribed at discharge';
COMMENT ON TABLE discharge_examinations IS 'Physical examination data at discharge';
COMMENT ON TABLE discharge_surgery_details IS 'Surgery details if patient underwent surgical procedures';

-- 10. Grant necessary permissions (adjust as needed for your setup)
-- GRANT ALL ON discharge_summaries TO authenticated;
-- GRANT ALL ON discharge_medications TO authenticated;
-- GRANT ALL ON discharge_examinations TO authenticated;
-- GRANT ALL ON discharge_surgery_details TO authenticated;