-- Nisha's cash roster row still points at the login she no longer has.
--
-- THE INSTRUCTION (19 Aug, Dr M): she is a cashier now; clean up the lists.
--
-- WHAT HAPPENED. On 18 Aug her receptionist account
-- im.nishasharma@gmail.com (426e9a69…, created 6 Jul) was deactivated, and a
-- cashier account gopalnisha789@gmail.com (5b4c5f52…) was created for her four
-- hours later. Her tiles were copied across. Her cash roster row was not: it
-- still names "Nisha Sharma" with can_hand_over = true against the dead id, and
-- with is_active = true it is still returned by fetchNominees(), so the roster
-- screen lists a person whose login nobody can sign into.
--
-- NO REPLACEMENT ROW IS CREATED, and that is deliberate.
-- can_use_cash_handover() admits the cashier role on its own — the same
-- reasoning recorded in 20260814150000 when Shoib was added — so her new
-- account already has the Cash Handover tile without a roster entry. Adding one
-- would be a second source of truth for a right she already holds, and this
-- exact class of duplication is what stranded cash under shared logins before.
--
-- DEACTIVATED, NOT DELETED, matching how the reception logins were retired on
-- 18 Aug: the row is referenced by id and a hard DELETE turns any reference
-- into a dangling id rather than an error. is_active = false is what
-- fetchNominees() filters on, so it disappears from the screen either way.
--
-- HER ACCOUNTING AND VOUCHER TILES GO WITH THE ROLE, in the same change:
-- accounting-access.ts and officeTileAccess.ts no longer name her old address.
-- A cashier banks the day's takings; she is not on the books any more.

DO $cleanup$
DECLARE
  v_old UUID := '426e9a69-b209-455a-8d13-225918804bb2';
  v_rows INT;
BEGIN
  -- Refuse if the account is somehow live again: this only makes sense while
  -- the login is genuinely retired.
  IF EXISTS (SELECT 1 FROM public."User" WHERE id = v_old AND is_active) THEN
    RAISE EXCEPTION 'ABORT: 426e9a69 is active again — do not retire its roster row';
  END IF;

  UPDATE public.cash_handover_verifiers
     SET is_active = false,
         updated_at = now()
   WHERE user_id = v_old
     AND is_active;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE NOTICE 'Nothing to do — no live roster row for the retired account.';
  END IF;
END
$cleanup$;

DO $verify$
DECLARE v_n INT;
BEGIN
  -- 1. No live roster row may point at a deactivated login, for anyone.
  SELECT count(*) INTO v_n
    FROM public.cash_handover_verifiers r
    JOIN public."User" u ON u.id = r.user_id
   WHERE r.is_active AND u.is_active = false;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % live roster row(s) still point at a deactivated login', v_n;
  END IF;

  -- 2. She must not have lost the ability to hand over — the role carries it.
  IF NOT public.can_use_cash_handover('5b4c5f52-2a41-46b4-be0d-0419d54453f5'::uuid) THEN
    RAISE EXCEPTION 'ABORT: her cashier account can no longer hand over cash';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
