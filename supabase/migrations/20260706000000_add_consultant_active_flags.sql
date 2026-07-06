ALTER TABLE public.hope_consultants
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

ALTER TABLE public.ayushman_consultants
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

UPDATE public.hope_consultants
SET is_active = true
WHERE is_active IS NULL;

UPDATE public.ayushman_consultants
SET is_active = true
WHERE is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_hope_consultants_is_active
  ON public.hope_consultants(is_active);

CREATE INDEX IF NOT EXISTS idx_ayushman_consultants_is_active
  ON public.ayushman_consultants(is_active);
