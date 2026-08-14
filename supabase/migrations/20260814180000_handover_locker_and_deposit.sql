-- The handover takes cash in the locker, and cash the cashier already banked.
--
-- A shift was reconciled as: notes counted in the drawer, against what the
-- software says was collected. That is only true if the drawer is the only
-- place the money can be. It is not. Cash sits in the locker, and a cashier who
-- banks part of the takings mid-shift has less in the drawer for a perfectly
-- good reason.
--
-- Both showed up as a shortfall, which is the worst possible outcome: a real
-- shortage and a locker are indistinguishable, so the variance stops meaning
-- anything and nobody chases it.
--
-- The rule is that money collected must be somewhere:
--
--     drawer + locker + already banked  =  what the software says
--
-- so variance becomes (counted + locker + deposit) - expected. It stays zero
-- for every existing row, because both new columns default to zero.
--
-- variance is a STORED generated column, so it has to be dropped and re-added
-- to change the expression. If anything depends on it this migration fails and
-- rolls back rather than half-applying.

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS locker_cash  NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_deposit NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cash_handovers.locker_cash IS
  'Cash the counter holds in the locker at handover. Held, not handed over.';
COMMENT ON COLUMN public.cash_handovers.bank_deposit IS
  'Cash this cashier paid into the bank during the shift. Out of the drawer, '
  'and accounted for, so it is not a shortfall.';

ALTER TABLE public.cash_handovers DROP COLUMN IF EXISTS variance;
ALTER TABLE public.cash_handovers
  ADD COLUMN variance NUMERIC(15,2)
  GENERATED ALWAYS AS (counted_cash + locker_cash + bank_deposit - expected_cash) STORED;

CREATE OR REPLACE FUNCTION public.submit_cash_handover(
  p_from_user_id UUID, p_to_user_id UUID, p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL, p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT true, p_notes TEXT DEFAULT NULL,
  p_declared_online NUMERIC DEFAULT NULL,
  p_locker_cash NUMERIC DEFAULT 0, p_bank_deposit NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutover TIMESTAMPTZ; v_from TEXT; v_to TEXT;
  v_expected NUMERIC := 0; v_counted NUMERIC := 0; v_count INT := 0;
  v_upi NUMERIC := 0; v_card NUMERIC := 0; v_unmatched BOOLEAN := false;
  v_id UUID; v_no TEXT; v_preview JSONB; v_since TIMESTAMPTZ;
  v_locker NUMERIC := GREATEST(COALESCE(p_locker_cash, 0), 0);
  v_deposit NUMERIC := GREATEST(COALESCE(p_bank_deposit, 0), 0);
  v_accounted NUMERIC := 0;
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
  -- already in the bank.
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
    declared_online, software_online, locker_cash, bank_deposit
  ) VALUES (
    v_no, p_hospital_type, p_from_user_id, v_from, p_to_user_id, v_to,
    COALESCE(v_since, v_cutover), now(), v_expected, v_counted,
    NULLIF(btrim(COALESCE(p_variance_reason,'')), ''),
    v_upi, v_card, true, NULLIF(btrim(COALESCE(p_notes,'')), ''),
    p_declared_online, v_upi + v_card, v_locker, v_deposit
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
  v_unmatched := (v_count = 0);

  PERFORM claim_handover_sources(v_id);
  UPDATE cash_handovers SET source_count = v_count, is_unmatched = v_unmatched WHERE id = v_id;

  RETURN jsonb_build_object(
    'handoverId', v_id, 'handoverNo', v_no, 'expectedCash', v_expected,
    'countedCash', v_counted, 'lockerCash', v_locker, 'bankDeposit', v_deposit,
    'variance', v_accounted - v_expected,
    'sourceCount', v_count, 'unmatched', v_unmatched,
    'softwareOnline', v_upi + v_card, 'declaredOnline', p_declared_online
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'That handover was already recorded';
END;
$$;

DO $verify$
DECLARE v_col TEXT; v_bad INT;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_col
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.cash_handovers'::regclass
     AND a.attname = 'variance' AND NOT a.attisdropped;
  IF v_col IS NULL OR v_col NOT LIKE '%locker_cash%' OR v_col NOT LIKE '%bank_deposit%' THEN
    RAISE EXCEPTION 'ABORT: variance does not account for the locker and the deposit (%)', v_col;
  END IF;

  -- Every existing handover must read exactly as it did before, because both
  -- new columns are zero on all of them. A changed history would be a
  -- rewriting of past reconciliations.
  SELECT count(*) INTO v_bad FROM public.cash_handovers
   WHERE round(variance - (counted_cash - expected_cash), 2) <> 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % past handover(s) changed value', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.cash_handovers
   WHERE locker_cash <> 0 OR bank_deposit <> 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) were seeded with a non-zero locker or deposit', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
