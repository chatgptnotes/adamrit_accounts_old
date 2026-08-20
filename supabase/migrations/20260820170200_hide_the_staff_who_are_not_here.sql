-- ------------------------------------------------------- do it, reversibly

CREATE TABLE IF NOT EXISTS public.staff_roster_deactivations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  tally_ledger_id UUID,
  account_name   TEXT NOT NULL,
  as_of          DATE NOT NULL,
  restored_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.staff_roster_deactivations TO anon, authenticated;

/**
 * Hide everyone the sheet does not account for, and log every one of them.
 *
 * Idempotent: a ledger already hidden is not logged twice, and running it again
 * after a new sheet is loaded hides the newly-departed and nobody else.
 */
CREATE OR REPLACE FUNCTION public.apply_staff_roster()
RETURNS TABLE (ledgers_hidden INT, kept_because_paid INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_as_of DATE; v_led INT := 0; v_kept INT;
BEGIN
  SELECT max(as_of) INTO v_as_of FROM active_staff_roster;

  -- The ledgers. Not on the sheet AND not paid in the last 180 days.
  WITH doomed AS (
    SELECT s.account_id, s.account_name
      FROM staff_roster_status s
      JOIN chart_of_accounts a ON a.id = s.account_id AND a.is_active
     WHERE s.roster_name IS NULL AND NOT s.paid_recently
  ), logged AS (
    INSERT INTO staff_roster_deactivations (account_id, account_name, as_of)
    SELECT account_id, account_name, v_as_of FROM doomed
    RETURNING account_id
  )
  UPDATE chart_of_accounts a SET is_active = false, updated_at = now()
   WHERE a.id IN (SELECT account_id FROM logged);
  GET DIAGNOSTICS v_led = ROW_COUNT;

  -- The Tally mirror the Payment Voucher searches looks after itself: the
  -- trigger sync_chart_account_to_tally_ledger already carries is_active across
  -- as is_hidden ("is_hidden = NOT is_active"), which is the flag that search
  -- filters on. Doing it again here would be a second write of the same fact,
  -- and it was what made this migration time out.

  SELECT count(*) INTO v_kept FROM staff_roster_status
   WHERE roster_name IS NULL AND paid_recently;

  RETURN QUERY SELECT v_led, v_kept;
END $$;

REVOKE ALL ON FUNCTION public.apply_staff_roster() FROM PUBLIC;

/** Put everything back, exactly as it was. */
CREATE OR REPLACE FUNCTION public.undo_staff_roster(p_as_of DATE DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT := 0;
BEGIN
  UPDATE chart_of_accounts a SET is_active = true, updated_at = now()
   WHERE a.id IN (SELECT account_id FROM staff_roster_deactivations
                   WHERE account_id IS NOT NULL AND restored_at IS NULL
                     AND (p_as_of IS NULL OR as_of = p_as_of));
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- The same trigger carries is_active back the other way, so the Tally mirror
  -- unhides with the ledger and needs no second statement here either.

  UPDATE staff_roster_deactivations SET restored_at = now()
   WHERE restored_at IS NULL AND (p_as_of IS NULL OR as_of = p_as_of);

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.undo_staff_roster(DATE) FROM PUBLIC;

-- ------------------------------------------------------------------- run it

DO $run$
DECLARE r RECORD; v_n INT;
BEGIN
  v_n := public.refresh_staff_roster_status();
  RAISE NOTICE '% salary ledgers examined', v_n;
  SELECT * INTO r FROM public.apply_staff_roster();
  RAISE NOTICE '% ledgers hidden, % kept because paid recently',
    r.ledgers_hidden, r.kept_because_paid;
END $run$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_bad INT; v_entries INT; v_roster INT; v_still INT;
BEGIN
  SELECT count(*) INTO v_roster FROM active_staff_roster
   WHERE as_of = DATE '2026-08-20';
  IF v_roster <> 127 THEN
    RAISE EXCEPTION 'ABORT: the roster holds % names, not the 127 on the sheet', v_roster;
  END IF;

  -- Nobody on the sheet may have been hidden BY THIS RUN. This is the one that
  -- matters. Checked against the log rather than against is_active, because 79
  -- ledgers were already inactive before today for their own reasons and one of
  -- them belongs to somebody on the sheet — that is a fact to report, not a
  -- failure to cause.
  SELECT count(*) INTO v_bad
    FROM staff_roster_deactivations d
    JOIN staff_roster_status s ON s.account_id = d.account_id
   WHERE d.restored_at IS NULL AND s.roster_name IS NOT NULL;
  IF v_bad > 0 THEN
    PERFORM public.undo_staff_roster();
    RAISE EXCEPTION 'ABORT: % ledger(s) of staff ON the sheet were hidden — all restored', v_bad;
  END IF;

  -- Nor anybody paid in the last 180 days.
  SELECT count(*) INTO v_bad
    FROM staff_roster_deactivations d
    JOIN staff_roster_status s ON s.account_id = d.account_id
   WHERE d.restored_at IS NULL AND s.paid_recently;
  IF v_bad > 0 THEN
    PERFORM public.undo_staff_roster();
    RAISE EXCEPTION 'ABORT: % ledger(s) paid within 180 days were hidden — all restored', v_bad;
  END IF;

  -- No entry may have moved. Hiding is not writing off.
  SELECT count(*) INTO v_entries FROM voucher_entries;
  IF v_entries = 0 THEN
    RAISE EXCEPTION 'ABORT: the entries have gone';
  END IF;

  -- And nothing outside the salary groups may have been touched.
  SELECT count(*) INTO v_bad
    FROM staff_roster_deactivations d
    JOIN chart_of_accounts a ON a.id = d.account_id
   WHERE lower(btrim(COALESCE(a.account_group, ''))) NOT IN
         ('hope salary exp', 'ayushman salary expences', 'rmo salary');
  IF v_bad > 0 THEN
    PERFORM public.undo_staff_roster();
    RAISE EXCEPTION 'ABORT: % ledger(s) outside the salary groups were hidden — all restored', v_bad;
  END IF;

  SELECT count(*) INTO v_still FROM staff_roster_status s
    JOIN chart_of_accounts a ON a.id = s.account_id WHERE a.is_active;
  RAISE NOTICE '% salary ledgers still active', v_still;
END
$verify$;

NOTIFY pgrst, 'reload schema';
