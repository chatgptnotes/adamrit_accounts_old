-- Each relationship manager has a persistent commission rate used by the
-- Director's Daily Revenue Report for new, unsaved visit cuts.
ALTER TABLE public.relationship_managers
  ADD COLUMN IF NOT EXISTS commission_percent numeric(5, 2) NOT NULL DEFAULT 25;

-- Keep the master setting within a valid percentage range.
ALTER TABLE public.relationship_managers
  DROP CONSTRAINT IF EXISTS relationship_managers_commission_percent_check;

ALTER TABLE public.relationship_managers
  ADD CONSTRAINT relationship_managers_commission_percent_check
  CHECK (commission_percent >= 0 AND commission_percent <= 100);
