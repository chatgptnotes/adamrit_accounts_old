-- Add Bhopal NABH and Bhopal non-NABH rate columns to radiology table

ALTER TABLE public.radiology
ADD COLUMN IF NOT EXISTS bhopal_nabh NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS bhopal_non_nabh NUMERIC(10, 2);

-- Add comments for documentation
COMMENT ON COLUMN public.radiology.bhopal_nabh IS 'Bhopal NABH accredited rate for radiology test';
COMMENT ON COLUMN public.radiology.bhopal_non_nabh IS 'Bhopal non-NABH rate for radiology test';
