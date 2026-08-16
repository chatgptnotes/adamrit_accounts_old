-- Put back the payout claim that 20260816210000 dropped.
--
-- WHAT WENT WRONG. 20260815150000_handover_claims_payouts.sql taught
-- submit_cash_handover to claim the payouts its expected figure was measured
-- against, so the same payment is never deducted twice. The next day
-- 20260816210000_locker_movements.sql added two locker columns by rebuilding
-- submit_cash_handover from 20260814180000 -- the version from BEFORE the
-- payout fix. The claim block and the payoutCount return field went with it.
--
-- Because the rebuild added two parameters, Postgres created a new 12-argument
-- function rather than replacing the 10-argument one, and the application --
-- which names all twelve -- has been calling the version with no payout claim
-- ever since. One handover was submitted in that window. It claimed nothing.
--
-- This is the failure CLAUDE.md names: rebuild functions from the live
-- database, not from a migration file. A migration file is only the truth on
-- the day it is applied.
--
-- WHAT THIS RESTORES. The body below is 20260815150000's, with only the locker
-- movement additions layered on top:
--   * p_locker_withdrawn / p_locker_deposited parameters
--   * the two columns on the INSERT
--   * lockerWithdrawn / lockerDeposited in the returned object
-- The movements stay OUT of v_accounted, for the reason they always were: what
-- leaves the locker is counted in the drawer, and what enters it is counted in
-- locker_cash. Adding them would count the same notes twice.
--
-- THE BACKLOG IS ABSORBED, NOT ERASED, exactly as it was on 15-Aug. The next
-- handover at each counter claims the payouts standing against it, reads short
-- by that much once, and needs a reason. Every handover after it starts clean.
-- Those payments did leave the drawer; writing them off would be inventing
-- cash.

CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID, p_to_user_id UUID, p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL, p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT true, p_notes TEXT DEFAULT NULL,
  p_declared_online NUMERIC DEFAULT NULL,
  p_locker_cash NUMERIC DEFAULT 0, p_bank_deposit NUMERIC DEFAULT 0,
  p_locker_withdrawn NUMERIC DEFAULT 0, p_locker_deposited NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_from TEXT; v_to TEXT;
  v_expected NUMERIC := 0; v_counted NUMERIC := 0; v_count INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0; v_unmatched BOOLEAN := false;
  v_id UUID; v_no TEXT; v_preview JSONB; v_since TIMESTAMPTZ;
  v_locker NUMERIC := GREATEST(COALESCE(p_locker_cash, 0), 0);
  v_deposit NUMERIC := GREATEST(COALESCE(p_bank_deposit, 0), 0);
  v_out NUMERIC := GREATEST(COALESCE(p_locker_withdrawn, 0), 0);
  v_in NUMERIC := GREATEST(COALESCE(p_locker_deposited, 0), 0);
  v_accounted NUMERIC := 0; v_payouts INT := 0;
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Both the person handing over and the person receiving are required';
  END IF;

  SELECT cutover_at INTO v_cutover FROM cash_handover_settings WHERE id;
  SELECT full_name INTO v_from FROM "User" WHERE id = p_from_user_id;
  SELECT full_name INTO v_to   FROM "User" WHERE id = p_to_user_id;

  SELECT COALESCE(sum((d->>'denomination')::NUMERIC * (d->>'qty')::NUMERIC), 0)
    INTO v_counted
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d;

  v_preview := cash_handover_preview(p_from_user_id, true, p_hospital_type);
  v_expected := (v_preview->>'expectedCash')::NUMERIC;
  v_upi := (v_preview->>'refUpiTotal')::NUMERIC;
  v_card := (v_preview->>'refCardTotal')::NUMERIC;

  -- Money collected has to be somewhere: in the drawer, in the locker, or
  -- already in the bank. The locker MOVEMENTS are not added here -- what left
  -- the locker is in the drawer and already counted, and what went in is in
  -- locker_cash. Adding them would count the same notes twice.
  v_accounted := v_counted + v_locker + v_deposit;

  IF round(v_accounted - v_expected, 2) <> 0 AND btrim(COALESCE(p_variance_reason,'')) = '' THEN
    RAISE EXCEPTION 'The cash accounted for differs from the software figure by %. Give a reason and the handover will still go through.',
      to_char(abs(v_accounted - v_expected), 'FM9,99,99,990.00');
  END IF;

  SELECT COALESCE(min(at), now()) INTO v_since
    FROM jsonb_to_recordset(v_preview->'lines') AS x(at TIMESTAMPTZ);

  v_no := 'CH-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD') || '-' ||
          lpad(nextval('cash_handover_no_seq')::TEXT, 4, '0');

  INSERT INTO cash_handovers (
    handover_no, hospital_type, from_user_id, from_user_name, to_user_id, to_user_name,
    period_from, period_to, expected_cash, counted_cash, variance_reason,
    ref_upi_total, ref_card_total, included_unattributed, notes,
    declared_online, software_online, locker_cash, bank_deposit,
    locker_withdrawn, locker_deposited
  ) VALUES (
    v_no, p_hospital_type, p_from_user_id, v_from, p_to_user_id, v_to,
    COALESCE(v_since, v_cutover), now(), v_expected, v_counted,
    NULLIF(btrim(COALESCE(p_variance_reason,'')), ''),
    v_upi, v_card, true, NULLIF(btrim(COALESCE(p_notes,'')), ''),
    p_declared_online, v_upi + v_card, v_locker, v_deposit,
    v_out, v_in
  ) RETURNING id INTO v_id;

  INSERT INTO cash_handover_denominations (handover_id, denomination, qty)
  SELECT v_id, (d->>'denomination')::INT, (d->>'qty')::INT
    FROM jsonb_array_elements(COALESCE(p_denominations, '[]'::jsonb)) d
   WHERE COALESCE((d->>'qty')::INT, 0) > 0;

  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount,
                                     collected_at, collected_by_user_id, collected_by_label, patient_name)
  SELECT v_id, x."table", x.id, x.amount, x.at, p_from_user_id, x.who, x.patient
    FROM jsonb_to_recordset(v_preview->'lines')
      AS x("table" TEXT, id TEXT, amount NUMERIC, at TIMESTAMPTZ, who TEXT, patient TEXT, mine BOOLEAN)
   WHERE x."table" IS NOT NULL AND x."table" <> 'payment_vouchers';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- Counted on RECEIPTS only, deliberately: "unmatched" means no receipt could
  -- be tied to this handover, and payouts have never been part of that test.
  v_unmatched := (v_count = 0);

  -- RESTORED. The payouts the expected figure was measured against, claimed so
  -- they are never deducted again. Recorded negative, because they left the
  -- drawer. The unique index on (source_table, source_id) is the concurrency
  -- guard: two cashiers submitting at the same instant cannot both take the
  -- same payout -- the second rolls back whole rather than double-counting it.
  INSERT INTO cash_handover_sources (handover_id, source_table, source_id, amount,
                                     collected_at, collected_by_user_id, collected_by_label)
  SELECT v_id, 'cash_payout', p.id::text, -p.amount, p.at, p_from_user_id,
         COALESCE(p.paid_by, p.label, 'Paid out')
    FROM cash_payouts_pool(p_hospital_type) p;
  GET DIAGNOSTICS v_payouts = ROW_COUNT;

  PERFORM claim_handover_sources(v_id);
  UPDATE cash_handovers SET source_count = v_count, is_unmatched = v_unmatched WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no, 'expectedCash', v_expected,
    'countedCash', v_counted, 'lockerCash', v_locker, 'bankDeposit', v_deposit,
    'lockerWithdrawn', v_out, 'lockerDeposited', v_in,
    'variance', v_accounted - v_expected,
    'sourceCount', v_count, 'payoutCount', v_payouts, 'unmatched', v_unmatched,
    'softwareOnline', v_upi + v_card, 'declaredOnline', p_declared_online
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'That handover was already recorded';
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cash_handover(
  uuid, uuid, jsonb, text, text, boolean, text, numeric, numeric, numeric, numeric, numeric
) TO anon, authenticated;

DO $verify$
DECLARE
  v_u UUID; v_u2 UUID; v_before NUMERIC; v_after NUMERIC; v_n INT;
  v_pool_before INT; v_pool_after INT; v_id UUID; v_res JSONB; v_sigs INT;
  v_lw NUMERIC; v_ld NUMERIC; v_var NUMERIC;
BEGIN
  -- Still exactly one function, so nothing can be ambiguous again.
  SELECT count(*) INTO v_sigs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_cash_handover';
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'ABORT: % submit_cash_handover overloads, expected 1', v_sigs;
  END IF;

  SELECT id INTO v_u  FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u LIMIT 1;
  IF v_u IS NULL OR v_u2 IS NULL THEN RAISE EXCEPTION 'ABORT: need two users'; END IF;

  SELECT count(*), COALESCE(sum(amount), 0) INTO v_pool_before, v_before
    FROM cash_payouts_pool('hope');

  -- (a) a handover claims the payouts, and they leave the pool.
  v_res := submit_cash_handover(
    v_u, v_u2, '[{"denomination":500,"qty":1}]'::jsonb, 'hope',
    'self test — verifying payouts are claimed again', true, 'self test', NULL,
    0, 0, 250, 100);
  v_id := (v_res->>'handoverId')::uuid;

  SELECT count(*) INTO v_pool_after FROM cash_payouts_pool('hope');
  IF v_pool_after <> 0 THEN
    RAISE EXCEPTION 'ABORT: % payout(s) still in the pool after a handover claimed them', v_pool_after;
  END IF;
  IF (v_res->>'payoutCount')::int <> v_pool_before THEN
    RAISE EXCEPTION 'ABORT: claimed % payouts but % were in the pool',
      v_res->>'payoutCount', v_pool_before;
  END IF;

  -- (b) the locker movements were stored, and did NOT move the variance.
  SELECT locker_withdrawn, locker_deposited, variance INTO v_lw, v_ld, v_var
    FROM cash_handovers WHERE id = v_id;
  IF v_lw <> 250 OR v_ld <> 100 THEN
    RAISE EXCEPTION 'ABORT: locker movements stored as %/%, expected 250/100', v_lw, v_ld;
  END IF;
  IF round(v_var - (500 + 0 + 0 - (v_res->>'expectedCash')::numeric), 2) <> 0 THEN
    RAISE EXCEPTION 'ABORT: the locker movements leaked into the variance';
  END IF;

  -- (c) cancelling gives the payouts back, because an undone handover
  --     absorbed nothing.
  PERFORM cancel_cash_handover(v_id, v_u, 'self test rollback');
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_pool_after, v_after
    FROM cash_payouts_pool('hope');
  IF v_pool_after <> v_pool_before OR round(v_after, 2) <> round(v_before, 2) THEN
    RAISE EXCEPTION 'ABORT: cancelling returned % payouts worth %, expected % worth %',
      v_pool_after, v_after, v_pool_before, v_before;
  END IF;

  DELETE FROM cash_handover_denominations WHERE handover_id = v_id;
  DELETE FROM cash_handover_sources WHERE handover_id = v_id;
  DELETE FROM cash_handovers WHERE id = v_id;

  SELECT count(*) INTO v_n FROM cash_handovers WHERE notes = 'self test';
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % self-test handover(s) left behind', v_n; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
