-- Add NABH Bhopal and NonNABH Bhopal columns to accommodations table
ALTER TABLE public.accommodations
ADD COLUMN IF NOT EXISTS nabh_bhopal NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS non_nabh_bhopal NUMERIC(10, 2);
