-- Direct (walk-in) patients on the "Incoming Referrals - Suraj Arpit" tile.
--
-- The tile announces referred patients before arrival. A walk-in arriving at
-- the front desk has no referee at all, but the front office still wants the
-- same announce-then-link flow so every arrival is on one list. Two changes:
--
--   is_direct        -- the announcement is a walk-in, nobody is owed a cut
--   referee_initials -- no longer NOT NULL, because a walk-in has no referee
--
-- Linking a direct announcement to a registration also marks the patient
-- direct in the app (patients.is_direct), which the existing
-- trg_block_referee_direct trigger then enforces. Rupali's Direct Patient
-- tile can undo that.
--
-- Applied automatically via apply_migration. Safe to run twice.

ALTER TABLE public.incoming_referrals
  ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.incoming_referrals
  ALTER COLUMN referee_initials DROP NOT NULL;

COMMENT ON COLUMN public.incoming_referrals.is_direct IS
  'The announced patient is a walk-in: no referee, no cut. referee_initials is NULL on these rows.';

NOTIFY pgrst, 'reload schema';

-- Proof: the column exists and a referee-less announcement is now accepted.
DO $verify$
DECLARE
  v_is_direct  BOOLEAN;
  v_nullable   TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'incoming_referrals'
       AND column_name = 'is_direct'
  ) INTO v_is_direct;
  IF NOT v_is_direct THEN
    RAISE EXCEPTION 'incoming_referrals.is_direct was not created';
  END IF;

  SELECT is_nullable INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'incoming_referrals'
     AND column_name = 'referee_initials';
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'incoming_referrals.referee_initials is still NOT NULL';
  END IF;

  RAISE NOTICE 'OK — incoming_referrals accepts direct (walk-in) announcements';
END;
$verify$;
