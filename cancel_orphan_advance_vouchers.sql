-- Cancel advance vouchers whose payment row no longer exists.
--
-- create_receipt_voucher_for_payment() fires on INSERT only, so the ledger
-- learns about a payment once and never hears about it again. Delete the
-- advance_payment row afterwards and its voucher stands alone, still crediting
-- 2110 Patient Advance for money that exists nowhere.
--
-- Identified 25 Jul 2026 across Apr-Jul 2026: 61 vouchers, Rs 4,01,186.
--
-- Scope is deliberately narrow. This cancels ONLY vouchers with no payment row
-- for that patient on that date at all. It does NOT touch the 135 vouchers
-- (Rs 7,01,050) whose row exists but at a different amount - those are
-- payments that were corrected downwards after posting, and the voucher is
-- stale rather than fictitious. Fixing those needs a decision about how edits
-- should flow to the ledger, which is a policy question.
--
-- Matching is one-to-one: both sides are ranked within (patient, date,
-- amount), so a patient with two genuine payments of the same amount matches
-- two vouchers and only the surplus is considered.
--
-- Soft cancel: the vouchers keep their numbers and stay visible, and
-- log_voucher_changes() records the action. To undo:
--   UPDATE vouchers SET status = 'AUTHORISED'
--    WHERE last_modified_by = 'orphan-voucher-cleanup';

DO $$
DECLARE
  -- ==================== SETTINGS ====================
  v_confirm      BOOLEAN := true;
  v_from_period  DATE    := '2026-04-01';

  -- Abort rather than cancel wholesale if the identification drifts.
  -- 61 were identified when this was written.
  v_max_expected INTEGER := 80;
  -- =================================================

  v_count  INTEGER;
  v_amount NUMERIC(15,2);
BEGIN
  IF NOT v_confirm THEN
    RAISE NOTICE 'Nothing cancelled. Set v_confirm := true to proceed.';
    RETURN;
  END IF;

  DROP TABLE IF EXISTS orphan_vouchers_to_cancel;

  CREATE TEMP TABLE orphan_vouchers_to_cancel AS
  WITH rows_ranked AS (
    SELECT patient_id, payment_date::date AS d, advance_amount AS amt,
           row_number() OVER (PARTITION BY patient_id, payment_date::date, advance_amount
                              ORDER BY id) AS rn
      FROM advance_payment
     WHERE COALESCE(status,'ACTIVE') <> 'CANCELLED'
       AND payment_date::date >= v_from_period
  ),
  v_ranked AS (
    SELECT v.id, v.total_amount, v.patient_id, v.voucher_date,
           row_number() OVER (PARTITION BY v.patient_id, v.voucher_date, v.total_amount
                              ORDER BY v.created_at, v.id) AS rn
      FROM vouchers v
      JOIN voucher_entries e   ON e.voucher_id = v.id
      JOIN chart_of_accounts a ON a.id = e.account_id
     WHERE a.account_code = '2110'
       AND v.status = 'AUTHORISED'
       AND COALESCE(v.reference_number,'') NOT LIKE '%-CORR-%'
       AND v.voucher_date >= v_from_period
  )
  SELECT v.id, v.total_amount
    FROM v_ranked v
    LEFT JOIN rows_ranked r
      ON r.patient_id = v.patient_id AND r.d = v.voucher_date
     AND r.amt = v.total_amount      AND r.rn = v.rn
   WHERE r.patient_id IS NULL
     -- bucket 1 only: no payment row for this patient on this date at all
     AND NOT EXISTS (
       SELECT 1 FROM advance_payment ap
        WHERE ap.patient_id = v.patient_id
          AND ap.payment_date::date = v.voucher_date
          AND COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
     );

  SELECT count(*), COALESCE(round(sum(total_amount), 2), 0)
    INTO v_count, v_amount
    FROM orphan_vouchers_to_cancel;

  IF v_count = 0 THEN
    RAISE NOTICE 'No orphan vouchers found. Nothing to do.';
    DROP TABLE orphan_vouchers_to_cancel;
    RETURN;
  END IF;

  IF v_count > v_max_expected THEN
    DROP TABLE orphan_vouchers_to_cancel;
    RAISE EXCEPTION 'Identified % orphans, above the guard of %. Aborting - re-check the identification before cancelling.',
      v_count, v_max_expected;
  END IF;

  UPDATE vouchers
     SET status           = 'CANCELLED',
         last_modified_by = 'orphan-voucher-cleanup',
         updated_at       = NOW()
   WHERE id IN (SELECT id FROM orphan_vouchers_to_cancel);

  RAISE NOTICE 'Cancelled % orphan vouchers totalling Rs %.', v_count, v_amount;

  DROP TABLE orphan_vouchers_to_cancel;
END;
$$;

-- To undo:
--   UPDATE vouchers SET status = 'AUTHORISED'
--    WHERE last_modified_by = 'orphan-voucher-cleanup';
