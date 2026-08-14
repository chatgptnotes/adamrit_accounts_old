-- Komal has two accounts. Close the one without her history.
--
-- WHICH IS THE DUPLICATE IS NOT OBVIOUS, so it is worth writing down.
--
--   komal@gmail.com        created 06 Jul. No uploads, no handovers, no
--                          payments -- but SIX logins, two of them this
--                          morning. This is the one she actually signs in with.
--
--   kamalnagrare@gmail.com created 15 Jul. One login, on the day it was made,
--                          and 158 patient document uploads on 16 Jul. Nothing
--                          since. This is where her work lives.
--
-- So the account she uses has no history, and the account with her history is
-- dormant. Closing either one costs something.
--
-- The one with the work survives, for two reasons. Her 158 uploads stay
-- attached to a live account rather than a closed one -- a monitor chart filed
-- by a deactivated user is a record nobody can follow up. And her login
-- address IS her Gmail there, so Google sign-in already reaches it; the other
-- account would have to be given an address it does not have.
--
-- THE COST, STATED PLAINLY: she signed in with komal@gmail.com at 05:05 and
-- 05:15 this morning, and after this she cannot. She must use Sign in with
-- Google on her own Gmail instead. Somebody has to tell her, and no migration
-- can do that.
--
-- Deactivated, never deleted. Her six logins remain auditable, and a mistake
-- here is one UPDATE away from being undone.

DO $apply$
DECLARE
  v_keep UUID; v_close UUID; v_uploads INT;
BEGIN
  SELECT id INTO v_keep  FROM public."User" WHERE lower(btrim(email)) = 'kamalnagrare@gmail.com';
  SELECT id INTO v_close FROM public."User" WHERE lower(btrim(email)) = 'komal@gmail.com';

  IF v_keep IS NULL OR v_close IS NULL THEN
    RAISE EXCEPTION 'ABORT: expected both Komal accounts; keep=% close=%', v_keep, v_close;
  END IF;
  IF v_keep = v_close THEN
    RAISE EXCEPTION 'ABORT: both addresses resolve to one account';
  END IF;

  -- Refuse if the survivor is not in fact the one holding the history. If the
  -- picture has changed since this was written, stop rather than close the
  -- wrong account.
  SELECT count(*) INTO v_uploads FROM public.file_uploads WHERE uploaded_by = v_keep;
  IF v_uploads = 0 THEN
    RAISE EXCEPTION 'ABORT: the account being kept has no uploads — check which is which before closing either';
  END IF;
  IF EXISTS (SELECT 1 FROM public.file_uploads WHERE uploaded_by = v_close) THEN
    RAISE EXCEPTION 'ABORT: the account being closed now has uploads of its own';
  END IF;

  -- Nothing financial may hang off the account being closed.
  IF EXISTS (SELECT 1 FROM public.cash_handovers WHERE from_user_id = v_close OR to_user_id = v_close)
     OR EXISTS (SELECT 1 FROM public.advance_payment WHERE collected_by_user_id = v_close)
     OR EXISTS (SELECT 1 FROM public.final_payments  WHERE collected_by_user_id = v_close) THEN
    RAISE EXCEPTION 'ABORT: money is recorded against the account being closed';
  END IF;

  UPDATE public."User" SET is_active = false WHERE id = v_close;
  UPDATE public."User" SET is_active = true  WHERE id = v_keep;
END
$apply$;

DO $verify$
DECLARE v_keep UUID; v_active INT; v_hits INT;
BEGIN
  SELECT id INTO v_keep FROM public."User" WHERE lower(btrim(email)) = 'kamalnagrare@gmail.com';

  IF (SELECT is_active FROM public."User" WHERE lower(btrim(email)) = 'komal@gmail.com') THEN
    RAISE EXCEPTION 'ABORT: the duplicate is still active';
  END IF;
  IF NOT (SELECT is_active FROM public."User" WHERE id = v_keep) THEN
    RAISE EXCEPTION 'ABORT: the surviving account is not active — Komal cannot get in at all';
  END IF;

  -- Exactly one active Komal, which is the whole point.
  SELECT count(*) INTO v_active FROM public."User"
   WHERE COALESCE(is_active, true)
     AND (lower(btrim(COALESCE(full_name, ''))) LIKE 'komal%'
          OR lower(btrim(email)) IN ('komal@gmail.com', 'kamalnagrare@gmail.com'));
  IF v_active <> 1 THEN
    RAISE EXCEPTION 'ABORT: % active Komal accounts remain, not 1', v_active;
  END IF;

  -- And Google sign-in reaches her, on exactly one row.
  SELECT count(*) INTO v_hits FROM public."User"
   WHERE COALESCE(is_active, true)
     AND (lower(btrim(email)) = 'kamalnagrare@gmail.com'
          OR lower(btrim(COALESCE(google_email, ''))) = 'kamalnagrare@gmail.com');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ABORT: her Gmail matches % active accounts, not 1', v_hits;
  END IF;

  -- Her work is still attached to a live account.
  IF (SELECT count(*) FROM public.file_uploads WHERE uploaded_by = v_keep) = 0 THEN
    RAISE EXCEPTION 'ABORT: her uploads are no longer on the surviving account';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
