-- The Tally mirror carries 1,439 more salary rows than the chart of accounts
-- does. They came in from Tally with no accounting_account_id, so the sync
-- trigger never touches them — and the Payment Voucher searches this table, not
-- the chart of accounts. Hiding a ledger nobody can see in one screen and can
-- still find in the other is not hiding it.
CREATE OR REPLACE FUNCTION public.apply_staff_roster_to_tally()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_as_of DATE; v_n INT := 0;
BEGIN
  SELECT max(as_of) INTO v_as_of FROM active_staff_roster;

  CREATE TEMP TABLE _keep ON COMMIT DROP AS
    SELECT DISTINCT ledger_key AS k FROM staff_roster_status
     WHERE (roster_name IS NOT NULL OR paid_recently) AND ledger_key <> '';

  CREATE TEMP TABLE _doomed ON COMMIT DROP AS
    SELECT t.id, t.name::TEXT AS name, staff_name_key(t.name) AS k
      FROM tally_ledgers t
     WHERE lower(btrim(COALESCE(t.parent_group, ''))) IN
           ('hope salary exp', 'ayushman salary expences', 'rmo salary')
       AND COALESCE(t.is_hidden, false) = false
       AND btrim(COALESCE(t.name, '')) <> '';

  DELETE FROM _doomed d WHERE d.k = '' OR EXISTS (SELECT 1 FROM _keep k WHERE k.k = d.k);

  INSERT INTO staff_roster_deactivations (tally_ledger_id, account_name, as_of)
  SELECT id, name, v_as_of FROM _doomed;

  UPDATE tally_ledgers t SET is_hidden = true, updated_at = now()
   WHERE t.id IN (SELECT id FROM _doomed);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.apply_staff_roster_to_tally() FROM PUBLIC;

DO $run$
DECLARE n INT; v_left INT; v_bad INT;
BEGIN
  n := public.apply_staff_roster_to_tally();

  -- Nobody the sheet keeps may have been hidden here either.
  SELECT count(*) INTO v_bad
    FROM staff_roster_deactivations d
    JOIN tally_ledgers t ON t.id = d.tally_ledger_id
   WHERE d.restored_at IS NULL
     AND staff_name_key(t.name) IN (SELECT ledger_key FROM staff_roster_status
                                     WHERE (roster_name IS NOT NULL OR paid_recently) AND ledger_key <> '');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % Tally row(s) of staff the sheet keeps were hidden', v_bad;
  END IF;

  SELECT count(*) INTO v_left FROM tally_ledgers t
   WHERE lower(btrim(COALESCE(t.parent_group, ''))) IN
         ('hope salary exp', 'ayushman salary expences', 'rmo salary')
     AND COALESCE(t.is_hidden, false) = false;
  RAISE NOTICE '% Tally rows hidden, % salary rows still searchable', n, v_left;
END $run$;
