-- Extend PMJAY / MJPJAY package master with surgeon, anaesthetist, implant,
-- and anaesthesia metadata.

ALTER TABLE public.pmjay_mjpjay_packages
  ADD COLUMN IF NOT EXISTS anaesthesia_type TEXT;

CREATE INDEX IF NOT EXISTS idx_pmjay_mjpjay_packages_anaesthesia_type
  ON public.pmjay_mjpjay_packages(anaesthesia_type);

CREATE TABLE IF NOT EXISTS public.pmjay_mjpjay_package_surgeons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.pmjay_mjpjay_packages(id) ON DELETE CASCADE,
  surgeon_id UUID REFERENCES public.hope_surgeons(id) ON DELETE SET NULL,
  surgeon_name TEXT NOT NULL,
  surgeon_department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, surgeon_name)
);

CREATE INDEX IF NOT EXISTS idx_pmjay_pkg_surgeons_package_id
  ON public.pmjay_mjpjay_package_surgeons(package_id);

CREATE INDEX IF NOT EXISTS idx_pmjay_pkg_surgeons_surgeon_id
  ON public.pmjay_mjpjay_package_surgeons(surgeon_id);

CREATE TABLE IF NOT EXISTS public.pmjay_mjpjay_package_anaesthetists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.pmjay_mjpjay_packages(id) ON DELETE CASCADE,
  anaesthetist_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, anaesthetist_name)
);

CREATE INDEX IF NOT EXISTS idx_pmjay_pkg_anaesthetists_package_id
  ON public.pmjay_mjpjay_package_anaesthetists(package_id);

CREATE TABLE IF NOT EXISTS public.pmjay_mjpjay_package_implants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.pmjay_mjpjay_packages(id) ON DELETE CASCADE,
  implant_id UUID REFERENCES public.implants(id) ON DELETE SET NULL,
  implant_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, implant_name)
);

CREATE INDEX IF NOT EXISTS idx_pmjay_pkg_implants_package_id
  ON public.pmjay_mjpjay_package_implants(package_id);

CREATE INDEX IF NOT EXISTS idx_pmjay_pkg_implants_implant_id
  ON public.pmjay_mjpjay_package_implants(implant_id);

ALTER TABLE public.pmjay_mjpjay_package_surgeons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pmjay_mjpjay_package_anaesthetists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pmjay_mjpjay_package_implants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow all on pmjay_mjpjay_package_surgeons"
    ON public.pmjay_mjpjay_package_surgeons FOR ALL
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all on pmjay_mjpjay_package_anaesthetists"
    ON public.pmjay_mjpjay_package_anaesthetists FOR ALL
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Allow all on pmjay_mjpjay_package_implants"
    ON public.pmjay_mjpjay_package_implants FOR ALL
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
