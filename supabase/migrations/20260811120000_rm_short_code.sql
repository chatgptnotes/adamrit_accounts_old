-- A hand-entered short code for a relationship manager (e.g. "SJ01").
-- Separate from `code`, which is the auto-assigned sequence number and is
-- denormalised onto patients.relationship_manager -- that one must not change.
ALTER TABLE public.relationship_managers
  ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Unique where set, case-insensitive. Blank/NULL rows are exempt so the
-- existing managers stay valid until someone fills their code in.
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_managers_short_code
  ON public.relationship_managers (upper(short_code))
  WHERE short_code IS NOT NULL AND short_code <> '';
