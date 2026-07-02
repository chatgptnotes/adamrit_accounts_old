-- Add corporate column to visits table
ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS corporate TEXT;

-- Add comments column to visits table for storing comments
ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS comments TEXT;

-- Create index on corporate column for faster filtering
CREATE INDEX IF NOT EXISTS idx_visits_corporate ON public.visits(corporate);