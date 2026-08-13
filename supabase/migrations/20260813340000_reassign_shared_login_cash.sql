-- Give the Rs 11,000 back to the people who took it.
--
-- hope@gmail.com was the counter's shared login and is now switched off. The
-- cash collected under it was stranded: attributed to an account nobody can
-- sign into, so nobody could hand it over.
--
-- The billing-executive name typed at the till is the evidence, and it is
-- specific -- "Avni" on the 10,000 and "Nisha Sharma" on the 1,000. Applied on
-- the owner's instruction, matching those names.
--
-- Deliberately narrow. Only CASH, only rows still attributed to that shared
-- login, only where the name matches one of these two people, and only rows no
-- handover has already claimed. The two ONLINE rows under the same login are
-- left alone: they were not part of the instruction, and online money is not
-- in anybody's drawer.

DO $move$
DECLARE
  v_shared UUID; v_avni UUID; v_nisha UUID;
  v_moved_avni INT; v_moved_nisha INT; v_total NUMERIC;
BEGIN
  SELECT id INTO v_shared FROM public."User" WHERE lower(email) = 'hope@gmail.com';
  SELECT id INTO v_avni   FROM public."User" WHERE lower(email) = 'avni@gmail.com';
  SELECT id INTO v_nisha  FROM public."User" WHERE lower(email) = 'nisha@gmail.com';
  IF v_shared IS NULL OR v_avni IS NULL OR v_nisha IS NULL THEN
    RAISE EXCEPTION 'ABORT: one of the three accounts is missing';
  END IF;

  UPDATE public.advance_payment
     SET collected_by_user_id = v_avni
   WHERE collected_by_user_id = v_shared
     AND cash_handover_id IS NULL
     AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH'
     AND lower(btrim(COALESCE(billing_executive, ''))) = 'avni';
  GET DIAGNOSTICS v_moved_avni = ROW_COUNT;

  UPDATE public.advance_payment
     SET collected_by_user_id = v_nisha
   WHERE collected_by_user_id = v_shared
     AND cash_handover_id IS NULL
     AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH'
     AND lower(btrim(COALESCE(billing_executive, ''))) IN ('nisha sharma', 'nisha');
  GET DIAGNOSTICS v_moved_nisha = ROW_COUNT;

  SELECT COALESCE(sum(advance_amount), 0) INTO v_total
    FROM public.advance_payment
   WHERE collected_by_user_id IN (v_avni, v_nisha)
     AND cash_handover_id IS NULL
     AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH';

  RAISE NOTICE 'moved % to Avni, % to Nisha; they now hold % in unclaimed cash',
    v_moved_avni, v_moved_nisha, v_total;

  -- Nothing may be left stranded on the dead login's cash.
  IF EXISTS (
    SELECT 1 FROM public.advance_payment
     WHERE collected_by_user_id = v_shared
       AND cash_handover_id IS NULL
       AND upper(btrim(COALESCE(payment_mode, ''))) = 'CASH'
       AND lower(btrim(COALESCE(billing_executive, ''))) IN ('avni', 'nisha sharma', 'nisha')
  ) THEN
    RAISE EXCEPTION 'ABORT: named cash is still attributed to the retired shared login';
  END IF;
END
$move$;

NOTIFY pgrst, 'reload schema';
