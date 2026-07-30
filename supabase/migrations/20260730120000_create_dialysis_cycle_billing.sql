-- Tracks how many dialysis cycles have already been billed for each patient.
-- A dialysis patient must be billed every 6 cycles: when
-- (total cycles - billed_cycles) >= 6 the billing desk is told to prepare a bill.
CREATE TABLE IF NOT EXISTS public.dialysis_cycle_billing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_name text NOT NULL DEFAULT 'hope',
    patient_key text NOT NULL,        -- patients_id when known, else 'name:<patient name>'
    patient_name text,
    billed_cycles integer NOT NULL DEFAULT 0,
    last_billed_on date,
    notes text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (hospital_name, patient_key)
);

CREATE INDEX IF NOT EXISTS idx_dialysis_cycle_billing_hospital
    ON public.dialysis_cycle_billing (hospital_name);

ALTER TABLE public.dialysis_cycle_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dcb_all ON public.dialysis_cycle_billing;
CREATE POLICY dcb_all ON public.dialysis_cycle_billing FOR ALL USING (true) WITH CHECK (true);
