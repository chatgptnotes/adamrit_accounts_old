-- Cath Lab Technician master: the outsourced technicians the OT scheduling
-- screen can pick for the "Cath Lab Assistant" slot, with the per-case fee
-- decided beforehand. Managed from the Cath Lab Technicians master page.

CREATE TABLE IF NOT EXISTS public.cathlab_technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  default_fee NUMERIC(12,2) NOT NULL DEFAULT 1000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cathlab_technicians_name_uidx
  ON public.cathlab_technicians (lower(name)) WHERE is_active;

ALTER TABLE public.cathlab_technicians ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cathlab_technicians') THEN
    CREATE POLICY cathlab_technicians_all ON public.cathlab_technicians
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.cathlab_technicians (name)
SELECT 'Arvind'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cathlab_technicians WHERE lower(name) = 'arvind'
);

NOTIFY pgrst, 'reload schema';
