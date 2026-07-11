ALTER TABLE public.implant_bills
  ADD COLUMN IF NOT EXISTS reference_link TEXT NOT NULL DEFAULT '';

UPDATE public.implant_bills
SET reference_link = COALESCE(reference_link, '')
WHERE reference_link IS NULL;

NOTIFY pgrst, 'reload schema';
