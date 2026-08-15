-- Cash paid out is deducted once, by the handover that absorbs it.
--
-- Receipts are claimed: a handover stamps them, they leave the pool, and the
-- next handover starts clean. Payouts never were. claim_handover_sources
-- clears advance payments, final payments, pharmacy sales and openings, and
-- submit_cash_handover explicitly excludes payment_vouchers when writing
-- sources -- so nothing has EVER set payment_vouchers.cash_handover_id:
--
--     payment_vouchers ever claimed:  0
--     advance_payment  ever claimed:  7
--
-- So the same payouts are subtracted from every handover, for ever. Hope's
-- drawer this morning: no unclaimed receipts, opening Rs 1,720, and Rs 11,770
-- of payouts going back to 12 August still being deducted -- expected MINUS
-- Rs 10,050, growing every day a payment is made.
--
-- KEYED ON THE VOUCHER, NOT THE PAYMENT VOUCHER. Of Hope's 34 stranded
-- payouts, 27 came through the payment-voucher rail and 7 were posted straight
-- to a cash ledger in the books, with no payment_vouchers row at all. Stamping
-- payment_vouchers.cash_handover_id -- the column that already exists for this
-- and was never used -- would fix 27 of 34 and leave the other 7 subtracted
-- for ever. cash_handover_sources keys on the voucher id, which both kinds
-- have.
--
-- IT NEEDS NO NEW RELEASE PATH. cancel_cash_handover already deletes this
-- handover's sources rows, and the unique index on (source_table, source_id)
-- already means a payout can be claimed exactly once. Reusing that machinery
-- is the point: a payout now behaves like a receipt, which is what it should
-- have done from the start.
--
-- THE BACKLOG IS ABSORBED, NOT ERASED. The next Hope handover claims all 34
-- and clears them, so it will still read minus Rs 10,050 and need a reason --
-- once. Every handover after it starts clean. Those payments did leave the
-- drawer; writing them off silently would be inventing cash.

-- 1. The sources table has to admit the new kind. ---------------------------
ALTER TABLE public.cash_handover_sources
  DROP CONSTRAINT IF EXISTS cash_handover_sources_source_table_check;
ALTER TABLE public.cash_handover_sources
  ADD CONSTRAINT cash_handover_sources_source_table_check
  CHECK (source_table IN ('advance_payment', 'final_payments',
                          'pharmacy_sales', 'pharmacy_credit_payments',
                          'cash_payout'));

-- 2. The pool stops offering what a live handover has already taken. --------
CREATE OR REPLACE FUNCTION public.cash_payouts_pool(p_hospital_type TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, amount NUMERIC, at TIMESTAMPTZ, entry_date DATE,
  label TEXT, voucher_no TEXT, paid_by TEXT, source TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  scope AS (SELECT lower(btrim(COALESCE(p_hospital_type, ''))) AS h),
  cash_ledgers AS (
    SELECT id, company_id FROM chart_of_accounts
     WHERE account_group IN ('CASH', 'Cash-in-Hand')
       AND lower(COALESCE(account_name, '')) NOT LIKE '%bank%'
  ),
  movement AS (
    SELECT v.id AS voucher_id,
           sum(ve.credit_amount) AS amount,
           min(v.created_at) AS at,
           min(v.voucher_date) AS entry_date,
           min(v.voucher_number) AS voucher_number,
           min(v.narration) AS narration,
           min(v.reference_number) AS reference_number,
           min(c.company_key) AS company_key
      FROM voucher_entries ve
      JOIN cash_ledgers cl ON cl.id = ve.account_id
      JOIN vouchers v ON v.id = ve.voucher_id
      LEFT JOIN companies c ON c.id = v.company_id
     WHERE ve.credit_amount > 0
       AND v.status = 'AUTHORISED'
       AND COALESCE(v.is_optional, false) = false
     GROUP BY v.id
  ),
  joined AS (
    SELECT m.voucher_id, m.amount, m.at, m.entry_date,
           m.voucher_number, m.narration, m.company_key,
           pv.voucher_no AS pv_no, pv.person_name, pv.paid_by, pv.hospital_type,
           pv.cash_handover_id,
           COALESCE(pv.created_at, m.at) AS effective_at
      FROM movement m
      LEFT JOIN payment_vouchers pv
             ON m.reference_number = 'PV-' || pv.id::text
  )
  SELECT j.voucher_id,
         j.amount,
         j.effective_at,
         j.entry_date,
         COALESCE(NULLIF(btrim(j.person_name), ''),
                  NULLIF(btrim(j.narration), ''),
                  'Cash payment') AS label,
         COALESCE(j.pv_no, j.voucher_number) AS voucher_no,
         COALESCE(
           (SELECT COALESCE(u.full_name, u.email) FROM public."User" u
             WHERE lower(u.email) = lower(btrim(COALESCE(j.paid_by, ''))) LIMIT 1),
           NULLIF(btrim(j.paid_by), '')
         ) AS paid_by,
         CASE WHEN j.pv_no IS NOT NULL THEN 'payment_voucher' ELSE 'accounting' END AS source
    FROM joined j, scope s, cutover cut
   WHERE j.cash_handover_id IS NULL
     -- Already absorbed by a handover that still stands. Cancelling one
     -- deletes its sources, so the payout comes back into the pool -- which is
     -- exactly what should happen when a handover is undone.
     AND NOT EXISTS (
           SELECT 1 FROM cash_handover_sources chs
            WHERE chs.source_table = 'cash_payout'
              AND chs.source_id = j.voucher_id::text
         )
     AND j.effective_at >= cut.cutover_at
     AND (
       s.h = ''
       OR lower(btrim(COALESCE(j.hospital_type, ''))) = s.h
       OR (j.hospital_type IS NULL AND s.h = 'hope' AND j.company_key = 'drm_pvt_ltd')
       OR (j.hospital_type IS NULL AND s.h = 'ayushman' AND j.company_key = 'ayushman_nagpur')
     );
$$;

-- 3. Submitting a handover claims the payouts it was measured against. ------
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
  -- Counted on RECEIPTS only, deliberately: "unmatched" means no receipt could
  -- be tied to this handover, and payouts have never been part of that test.
  v_unmatched := (v_count = 0);

  -- The payouts the expected figure was measured against, claimed so they are
  -- never deducted again. Recorded negative, because they left the drawer.
  -- The unique index on (source_table, source_id) is the concurrency guard: two
  -- cashiers submitting at the same instant cannot both take the same payout --
  -- the second rolls back whole rather than double-counting it.
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
    'variance', v_accounted - v_expected,
    'sourceCount', v_count, 'payoutCount', v_payouts, 'unmatched', v_unmatched,
    'softwareOnline', v_upi + v_card, 'declaredOnline', p_declared_online
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'That handover was already recorded';
END;
$$;

DO $verify$
DECLARE
  v_u UUID; v_u2 UUID; v_before NUMERIC; v_after NUMERIC; v_n INT;
  v_pool_before INT; v_pool_after INT; v_id UUID; v_res JSONB; v_exp NUMERIC;
BEGIN
  SELECT id INTO v_u  FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u LIMIT 1;
  IF v_u IS NULL OR v_u2 IS NULL THEN RAISE EXCEPTION 'ABORT: need two users'; END IF;

  -- The live pool before we touch anything, so the assertions below are
  -- measured against reality rather than a guess.
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_pool_before, v_before
    FROM cash_payouts_pool('hope');
  IF v_pool_before = 0 THEN
    RAISE NOTICE 'No stranded payouts at hope; the claim path is still proven below.';
  END IF;

  -- (a) a handover claims them, and they leave the pool.
  v_res := submit_cash_handover(
    v_u, v_u2, '[{"denomination":500,"qty":1}]'::jsonb, 'hope',
    'self test — verifying payouts are claimed', true, 'self test', NULL, 0, 0);
  v_id := (v_res->>'handoverId')::uuid;

  SELECT count(*), COALESCE(sum(amount), 0) INTO v_pool_after, v_after
    FROM cash_payouts_pool('hope');
  IF v_pool_after <> 0 THEN
    RAISE EXCEPTION 'ABORT: % payout(s) still in the pool after a handover claimed them', v_pool_after;
  END IF;
  IF (v_res->>'payoutCount')::int <> v_pool_before THEN
    RAISE EXCEPTION 'ABORT: claimed % payouts but % were in the pool',
      v_res->>'payoutCount', v_pool_before;
  END IF;

  -- (b) THE POINT: a second handover no longer deducts them again.
  SELECT (cash_handover_preview(v_u, true, 'hope')->>'payoutAmount')::numeric INTO v_exp;
  IF round(v_exp, 2) <> 0 THEN
    RAISE EXCEPTION 'ABORT: the next handover still sees Rs % of payouts', v_exp;
  END IF;

  -- (c) cancelling gives them back, because an undone handover absorbed nothing
  PERFORM cancel_cash_handover(v_id, v_u, 'self test rollback');
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_pool_after, v_after
    FROM cash_payouts_pool('hope');
  IF v_pool_after <> v_pool_before OR round(v_after, 2) <> round(v_before, 2) THEN
    RAISE EXCEPTION 'ABORT: cancelling returned % payouts worth % , expected % worth %',
      v_pool_after, v_after, v_pool_before, v_before;
  END IF;

  -- Remove the self-test handover entirely.
  DELETE FROM cash_handover_denominations WHERE handover_id = v_id;
  DELETE FROM cash_handover_sources WHERE handover_id = v_id;
  DELETE FROM cash_handovers WHERE id = v_id;

  SELECT count(*) INTO v_n FROM cash_handovers WHERE notes = 'self test';
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % self-test handover(s) left behind', v_n; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
