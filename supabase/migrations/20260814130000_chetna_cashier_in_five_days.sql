-- Chetna keeps superadmin until 19-Aug-2026, then becomes a cashier.
--
-- Asked for on 14-Aug: keep her superadmin for five more days, and make her a
-- cashier in Ayushman after that. Doing it by hand on the day is the kind of
-- thing that gets forgotten, so it is scheduled rather than diarised.
--
-- The change is real, not cosmetic. She is superadmin at Hope today and signed
-- in this morning, so on the 19th she loses the administrative screens and
-- moves to Ayushman's data. That is the instruction; it is written down here
-- so nobody is surprised by it next week.
--
-- NOTE, and it matters: the Cash Handover tile is not gated by role at all.
-- modulesForUser() ignores tile access entirely (`void canSeeTile`) and the
-- cash-handover module declares no `roles`, so every one of the 104 active
-- users can already open it, Chetna included, today. Nothing here withholds it
-- from her in the meantime -- there is nothing to withhold. If the intent was
-- that she must NOT touch cash handover before the 19th, that tile has to be
-- gated first, which is a change affecting everybody and was not made here.

-- The job fires once, at 01:00 on 19 August, then removes itself. The date is
-- in the schedule, so without the self-unschedule it would fire again every
-- August.
SELECT cron.schedule(
  'chetna_cashier_20260819',
  '0 1 19 8 *',
  $cmd$
  DO $job$
  DECLARE v_others INT; v_id UUID;
  BEGIN
    SELECT id INTO v_id FROM public."User" WHERE lower(email) = 'chetna@hopehospital.com';
    IF v_id IS NULL THEN
      RAISE WARNING 'Chetna role change skipped: no account for chetna@hopehospital.com';
      RETURN;
    END IF;

    -- Never leave the hospital without administrators, even five days from now
    -- when this runs unattended and nobody is watching.
    SELECT count(*) INTO v_others FROM public."User"
     WHERE lower(role) IN ('superadmin', 'super_admin')
       AND COALESCE(is_active, true) <> false
       AND id <> v_id;
    IF v_others < 2 THEN
      RAISE WARNING 'Chetna role change skipped: only % other active superadmin(s)', v_others;
      RETURN;
    END IF;

    UPDATE public."User"
       SET role = 'cashier', hospital_type = 'ayushman'
     WHERE id = v_id;

    PERFORM cron.unschedule('chetna_cashier_20260819');
  END $job$;
  $cmd$
);

DO $verify$
DECLARE v_n INT; v_role TEXT;
BEGIN
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'chetna_cashier_20260819';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the scheduled change was not registered (found % job(s))', v_n;
  END IF;

  -- And she must still be superadmin right now. If this migration demoted her
  -- today it would have got the whole point backwards.
  SELECT role INTO v_role FROM public."User" WHERE lower(email) = 'chetna@hopehospital.com';
  IF v_role <> 'superadmin' THEN
    RAISE EXCEPTION 'ABORT: Chetna is already %, expected superadmin until the 19th', v_role;
  END IF;
END
$verify$;
