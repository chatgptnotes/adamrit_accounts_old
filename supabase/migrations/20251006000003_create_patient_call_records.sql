-- Create patient_call_records table for Patient Overview Station
-- This table stores call history, dispositions, and follow-up information for discharged patients

CREATE TABLE IF NOT EXISTS public.patient_call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  visit_id UUID REFERENCES public.visits(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,

  -- Patient Information (denormalized for quick access)
  patient_name TEXT,
  patient_phone TEXT,
  hospital_name TEXT,

  -- Call Information
  call_date DATE NOT NULL DEFAULT CURRENT_DATE,
  called_on TIMESTAMP WITH TIME ZONE,
  discharge_date DATE,

  -- Budget and Financial
  budget_amount TEXT,

  -- Disposition Information
  disposition TEXT,
  sub_disposition TEXT,

  -- Follow-up Information
  follow_up_date DATE,
  follow_up_required BOOLEAN DEFAULT false,

  -- Additional Details
  relationship_man TEXT,
  diagnosis_surgery TEXT,
  admission_type TEXT,
  department TEXT,

  -- Telecaller Information
  telecaller_name TEXT,

  -- Update Reason (for All Patient tab)
  update_reason TEXT,

  -- Remarks and Comments
  remark TEXT,
  notes TEXT,

  -- Call Status
  call_status TEXT DEFAULT 'pending' CHECK (call_status IN ('pending', 'completed', 'failed', 'scheduled')),
  call_outcome TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Create indexes for better query performance
CREATE INDEX idx_patient_call_records_visit_id ON public.patient_call_records(visit_id);
CREATE INDEX idx_patient_call_records_patient_id ON public.patient_call_records(patient_id);
CREATE INDEX idx_patient_call_records_call_date ON public.patient_call_records(call_date);
CREATE INDEX idx_patient_call_records_discharge_date ON public.patient_call_records(discharge_date);
CREATE INDEX idx_patient_call_records_hospital_name ON public.patient_call_records(hospital_name);
CREATE INDEX idx_patient_call_records_telecaller ON public.patient_call_records(telecaller_name);
CREATE INDEX idx_patient_call_records_disposition ON public.patient_call_records(disposition);
CREATE INDEX idx_patient_call_records_follow_up_date ON public.patient_call_records(follow_up_date);
CREATE INDEX idx_patient_call_records_call_status ON public.patient_call_records(call_status);
CREATE INDEX idx_patient_call_records_update_reason ON public.patient_call_records(update_reason);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_patient_call_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_patient_call_records_updated_at
  BEFORE UPDATE ON public.patient_call_records
  FOR EACH ROW
  EXECUTE FUNCTION update_patient_call_records_updated_at();

-- Enable Row Level Security
ALTER TABLE public.patient_call_records ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow authenticated users to view call records
CREATE POLICY "Allow authenticated users to view call records"
  ON public.patient_call_records
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert call records
CREATE POLICY "Allow authenticated users to insert call records"
  ON public.patient_call_records
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update call records
CREATE POLICY "Allow authenticated users to update call records"
  ON public.patient_call_records
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete call records
CREATE POLICY "Allow authenticated users to delete call records"
  ON public.patient_call_records
  FOR DELETE
  TO authenticated
  USING (true);

-- Add comments for documentation
COMMENT ON TABLE public.patient_call_records IS 'Stores call records and follow-up information for Patient Overview Station';
COMMENT ON COLUMN public.patient_call_records.visit_id IS 'Reference to the visit record';
COMMENT ON COLUMN public.patient_call_records.patient_id IS 'Reference to the patient record';
COMMENT ON COLUMN public.patient_call_records.call_date IS 'Date when the call was made or scheduled';
COMMENT ON COLUMN public.patient_call_records.discharge_date IS 'Date when patient was discharged (for tracking 5-day follow-up)';
COMMENT ON COLUMN public.patient_call_records.budget_amount IS 'Budget amount allocated for treatment';
COMMENT ON COLUMN public.patient_call_records.disposition IS 'Call disposition category (e.g., Positive Feedback, Not Reachable)';
COMMENT ON COLUMN public.patient_call_records.sub_disposition IS 'Detailed sub-disposition';
COMMENT ON COLUMN public.patient_call_records.follow_up_date IS 'Date scheduled for next follow-up call';
COMMENT ON COLUMN public.patient_call_records.telecaller_name IS 'Name of telecaller handling this call';
COMMENT ON COLUMN public.patient_call_records.update_reason IS 'Reason for updating patient record (from All Patient tab - e.g., Follow-up Required, Emergency, etc.)';
COMMENT ON COLUMN public.patient_call_records.remark IS 'Additional remarks or notes from the call';
COMMENT ON COLUMN public.patient_call_records.call_status IS 'Status of the call (pending, completed, failed, scheduled)';
