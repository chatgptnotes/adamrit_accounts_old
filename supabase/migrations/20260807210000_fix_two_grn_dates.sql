-- Two GRNs dated in the future, and the vouchers they raised.
--
--   GRN26050021  2030-05-08 -> 2026-05-08
--       A year typo. Its purchase order was placed 08 May 2026, the GRN was
--       entered on 13 May 2026, and the number itself encodes 26-05. The day
--       and month were already right; only the year was wrong.
--
--   GRN26080003  2026-08-31 -> 2026-08-01
--       Entered at 00:25 IST on 1 August 2026 (18:55 UTC on 31 July) against a
--       purchase order raised the same evening, and numbered as the third GRN
--       of August. The day was typed from the July date the work started on
--       while the month had already rolled over.
--
-- The purchase voucher each GRN raised carries the same date, so it moves too
-- — otherwise the Day Book still shows a 2030 purchase. Amounts, ledgers and
-- voucher numbers are untouched, and both corrections stay inside the period
-- the goods were actually received, so no month's totals move except May 2026
-- gaining the Rs 624.75 that was sitting in 2030.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — the GRNs
-- ---------------------------------------------------------------------------
UPDATE public.goods_received_notes
   SET grn_date = DATE '2026-05-08', updated_at = NOW()
 WHERE grn_number = 'GRN26050021' AND grn_date = DATE '2030-05-08';

UPDATE public.goods_received_notes
   SET grn_date = DATE '2026-08-01', updated_at = NOW()
 WHERE grn_number = 'GRN26080003' AND grn_date = DATE '2026-08-31';

-- ---------------------------------------------------------------------------
-- STEP 2 — the vouchers those GRNs raised, matched through the GRN id rather
-- than by voucher number, so this cannot touch anything else
-- ---------------------------------------------------------------------------
UPDATE public.vouchers v
   SET voucher_date = g.grn_date,
       last_modified_by = 'grn-date-correction',
       updated_at = NOW()
  FROM public.goods_received_notes g
 WHERE g.grn_number IN ('GRN26050021', 'GRN26080003')
   AND v.status <> 'CANCELLED'
   AND (v.reference_number = g.id::TEXT
        OR v.reference_number = 'PHARMACY-JV-PURCHASE-' || g.id::TEXT)
   AND v.voucher_date IS DISTINCT FROM g.grn_date;

-- ---------------------------------------------------------------------------
-- STEP 3 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_future INTEGER;
  v_mismatched INTEGER;
  v_unbalanced INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_future
    FROM public.goods_received_notes
   WHERE status = 'POSTED' AND grn_date > CURRENT_DATE;
  IF v_future > 0 THEN
    RAISE EXCEPTION 'ABORT: % posted GRN(s) are still dated in the future', v_future;
  END IF;

  -- Every voucher raised by these two must now agree with its GRN.
  SELECT COUNT(*) INTO v_mismatched
    FROM public.vouchers v
    JOIN public.goods_received_notes g
      ON v.reference_number = g.id::TEXT
      OR v.reference_number = 'PHARMACY-JV-PURCHASE-' || g.id::TEXT
   WHERE g.grn_number IN ('GRN26050021', 'GRN26080003')
     AND v.status <> 'CANCELLED'
     AND v.voucher_date IS DISTINCT FROM g.grn_date;
  IF v_mismatched > 0 THEN
    RAISE EXCEPTION 'ABORT: % voucher(s) still carry the old date', v_mismatched;
  END IF;

  SELECT COUNT(*) INTO v_unbalanced
    FROM (
      SELECT e.voucher_id
        FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE v.status = 'AUTHORISED'
       GROUP BY e.voucher_id
      HAVING ABS(COALESCE(SUM(e.debit_amount), 0) - COALESCE(SUM(e.credit_amount), 0)) > 0.01
    ) x;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % authorised vouchers have debits <> credits', v_unbalanced;
  END IF;

  RAISE NOTICE 'OK — both GRNs and their vouchers now sit on the dates the goods were received';
END $$;
