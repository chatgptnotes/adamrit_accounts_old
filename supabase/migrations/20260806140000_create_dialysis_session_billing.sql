-- Billing completion is recorded per dialysis visit date, not as a six-session total.
CREATE TABLE IF NOT EXISTS public.dialysis_session_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name text NOT NULL,
  dialysis_visit_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  session_date date NOT NULL,
  billed_at timestamptz NOT NULL DEFAULT now(),
  billed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_name, dialysis_visit_id)
);

CREATE INDEX IF NOT EXISTS idx_dialysis_session_billing_patient
  ON public.dialysis_session_billing (hospital_name, patient_id, session_date DESC);

ALTER TABLE public.dialysis_session_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialysis_session_billing_all ON public.dialysis_session_billing;
CREATE POLICY dialysis_session_billing_all ON public.dialysis_session_billing
  FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.dialysis_session_billing TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
