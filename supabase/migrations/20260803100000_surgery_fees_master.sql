-- Surgery Fees Payable master: what the hospital pays the surgeon for a
-- procedure, decided BEFOREHAND — one panel rate (Yojana/corporate patients)
-- and one private rate. The surgeon's system-generated invoice takes its
-- amount from here, matched on the procedure name or any tag (related
-- surgery names and corporate package names), never typed on the OT page.

CREATE TABLE IF NOT EXISTS public.surgery_fee_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_name TEXT NOT NULL,
  surgery_id UUID REFERENCES public.cghs_surgery(id) ON DELETE SET NULL,
  -- Related surgery names + corporate package names that map to this row.
  tags TEXT[] NOT NULL DEFAULT '{}',
  panel_rate NUMERIC(12,2),
  private_rate NUMERIC(12,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS surgery_fee_master_name_uidx
  ON public.surgery_fee_master (lower(procedure_name)) WHERE is_active;

ALTER TABLE public.surgery_fee_master ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'surgery_fee_master') THEN
    CREATE POLICY surgery_fee_master_all ON public.surgery_fee_master
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
