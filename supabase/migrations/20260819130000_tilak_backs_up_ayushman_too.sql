-- Tilak can stand in for an Ayushman cashier, as Avni already can.
--
-- THE INSTRUCTION (19 Aug, Dr M): Tilak and Avni should be able to switch to
-- Ayushman and take a handover on behalf of the cashiers there.
--
-- AVNI ALREADY CAN, and nothing here touches her. Her roster row carries
-- hospital_type '*', the group-wide wildcard, and fetchNominees() asks for
-- ('*', <hospital>) — so she appears at every counter, Ayushman included.
--
-- TILAK COULD NOT, and the reason is not the guard. can_backup_handover()
-- checks only that a person holds ANY active row with can_backup, so he passed
-- it everywhere already. The block is the roster: he holds rows for 'hope' and
-- 'pharmacy' only, so on Ayushman fetchNominees('ayushman') returns nothing for
-- him, CashHandoverFlow computes canBackup = false from that list, and the
-- "counting for someone else" option is never drawn. He is missing from the
-- screen, not refused by it.
--
-- A THIRD EXPLICIT ROW, NOT THE WILDCARD. Avni's '*' is right for her — she
-- receives everywhere. Tilak is modelled as one row per counter he actually
-- works, and naming Ayushman keeps it that way: it is visible in the roster
-- screen, and it can be withdrawn from Ayushman alone without disturbing Hope
-- or the pharmacy.
--
-- SAME RIGHTS AS HIS OTHER TWO COUNTERS. can_receive so the cash can come to
-- him, can_backup so he may count for a cashier who is not there, and
-- can_hand_over false — he is a collection point, not a drawer.

DO $add$
DECLARE
  v_tilak UUID;
  v_existing INT;
BEGIN
  SELECT user_id INTO v_tilak
    FROM public.cash_handover_verifiers
   WHERE lower(btrim(display_name)) = 'tilak' AND is_active
   ORDER BY created_at
   LIMIT 1;

  IF v_tilak IS NULL THEN
    RAISE EXCEPTION 'ABORT: no active roster row named Tilak to copy from';
  END IF;

  SELECT count(*) INTO v_existing
    FROM public.cash_handover_verifiers
   WHERE user_id = v_tilak AND hospital_type IN ('ayushman', '*');
  IF v_existing > 0 THEN
    RAISE NOTICE 'Nothing to do — Tilak already reaches Ayushman.';
    RETURN;
  END IF;

  INSERT INTO public.cash_handover_verifiers
    (user_id, display_name, hospital_type, can_hand_over, can_receive, can_verify, can_backup, is_active)
  VALUES
    (v_tilak, 'Tilak', 'ayushman', false, true, false, true, true);
END
$add$;

DO $verify$
DECLARE
  v_tilak UUID;
  v_counters TEXT;
  v_avni INT;
BEGIN
  SELECT user_id INTO v_tilak
    FROM public.cash_handover_verifiers
   WHERE lower(btrim(display_name)) = 'tilak' AND is_active
   ORDER BY created_at LIMIT 1;

  -- 1. He must now reach Ayushman with the backup right.
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_handover_verifiers
     WHERE user_id = v_tilak AND is_active AND can_backup
       AND hospital_type IN ('ayushman', '*')
  ) THEN
    RAISE EXCEPTION 'ABORT: Tilak still cannot back up an Ayushman cashier';
  END IF;

  -- 2. His existing counters must be untouched.
  SELECT string_agg(hospital_type, ',' ORDER BY hospital_type) INTO v_counters
    FROM public.cash_handover_verifiers
   WHERE user_id = v_tilak AND is_active;
  IF v_counters <> 'ayushman,hope,pharmacy' THEN
    RAISE EXCEPTION 'ABORT: his counters are now %, expected ayushman,hope,pharmacy', v_counters;
  END IF;

  -- 3. Avni is not touched and still reaches every counter.
  SELECT count(*) INTO v_avni
    FROM public.cash_handover_verifiers
   WHERE lower(btrim(display_name)) LIKE 'avni%' AND is_active
     AND hospital_type = '*' AND can_backup;
  IF v_avni < 1 THEN
    RAISE EXCEPTION 'ABORT: Avni no longer holds a group-wide backup row';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
