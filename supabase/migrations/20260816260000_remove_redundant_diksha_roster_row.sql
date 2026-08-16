-- Remove the Hope roster row added for Diksha Sakhare a few minutes ago.
--
-- 20260816250000 added it on a mis-read. The diagnostic that reported "no
-- roster rows" matched on a name LIKE '%diksha%' with LIMIT 1, and there are
-- two Dikshas -- it answered for Diksha Chauhan, the nurse. Diksha Sakhare
-- already had a '*' row with can_hand_over, which covers every counter, so she
-- could open the cash tiles all along. What actually blocked her was the login
-- address, and that part of 20260816250000 stands.
--
-- The duplicate is not harmless. The nominee list queries
--   hospital_type IN ('*', <counter>)
-- so somebody holding both rows is offered twice in the same dropdown. She has
-- can_receive false on both, so nobody has seen it yet; removing it now costs
-- nothing and stops a puzzle later.
--
-- Deleting only the row this pair of migrations created. The '*' row predates
-- today and is left exactly as it was.

DO $undo$
DECLARE
  v_id UUID := '42da42fc-c815-4cd0-96ee-8e09169f7882';
  v_all INT; v_deleted INT;
BEGIN
  -- Only safe to drop the counter row if the wildcard is really there and
  -- really lets her hand over. Otherwise this would take her access away.
  SELECT count(*) INTO v_all FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND hospital_type = '*'
     AND can_hand_over AND COALESCE(is_active, true);
  IF v_all <> 1 THEN
    RAISE EXCEPTION 'ABORT: % usable wildcard row(s); leaving the hope row alone', v_all;
  END IF;

  DELETE FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND hospital_type = 'hope';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'ABORT: deleted % hope row(s), expected 1', v_deleted;
  END IF;
END
$undo$;

DO $verify$
DECLARE
  v_id UUID := '42da42fc-c815-4cd0-96ee-8e09169f7882';
  v_rows INT;
BEGIN
  -- The whole point: she must still be able to open the tile.
  IF NOT public.can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: Diksha can no longer open the cash tiles';
  END IF;

  -- And be offered exactly once for the Hope counter.
  SELECT count(*) INTO v_rows FROM public.cash_handover_verifiers
   WHERE user_id = v_id AND hospital_type IN ('*', 'hope') AND COALESCE(is_active, true);
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ABORT: % rows match the Hope nominee query, expected 1', v_rows;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
