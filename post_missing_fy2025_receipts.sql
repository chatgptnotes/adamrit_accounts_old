-- Post the advance receipts that never reached the ledger.
--
-- The receipt trigger was not firing between roughly Nov 2025 and Mar 2026:
--
--   Nov 2025   collected 2,25,993   posted     3,650
--   Dec 2025   collected 17,22,155  posted         0
--   Jan 2026   collected 69,52,427  posted         0
--   Feb 2026   collected 58,58,932  posted         0
--   Mar 2026   collected 69,72,419  posted 18,59,400
--
-- About Rs 1.99 crore of cash was collected with no accounting entry at all -
-- neither the bank debit nor the liability credit. This is not a
-- misclassification like the others; the money is simply absent from the books.
--
-- Posts Dr Bank/Cash / Cr 2110 Patient Advance for the missing amount,
-- aggregated by month and by the account the money went into so bank
-- reconciliation holds. Refund rows are netted off and reverse the entry.
--
-- ============================ THE DECISION ============================
-- These months fall in FY 2025-26, which was deliberately left alone when the
-- advance liability was corrected. v_date_policy chooses how to handle that:
--
--   'original'  date each voucher in its own month. Truest to what happened,
--               but writes into a year that may already be filed.
--   'opening'   date everything at v_opening_date (default 1 Apr 2026), so the
--               cash and liability arrive as opening balances in the current
--               year and the prior year is untouched. Standard treatment when
--               a period cannot be reopened - but the ledger will then show
--               the cash arriving later than the bank statement does.
--
-- Worth establishing first: was THIS ledger the book of record for FY 2025-26?
-- Given the Tally integration, the statutory accounts may have been prepared
-- elsewhere, in which case this is about making this system usable going
-- forward rather than correcting a filed return - and 'original' becomes the
-- easy choice.
-- ======================================================================
--
-- NOTHING IS POSTED until v_confirm is true. Run it as-is to see the summary
-- at the bottom, which lists what is missing. That same summary verifies the
-- result afterwards: once posted, the missing figures drop to zero.

DO $$
DECLARE
  -- ==================== SETTINGS ====================
  -- Enabled 26 Jul 2026, dated in the original months: these receipts are
  -- restored to the period they actually belong to.
  v_confirm      BOOLEAN := true;

  v_from_period  DATE := '2025-09-01';
  v_upto_period  DATE := '2026-03-01';

  v_date_policy  TEXT := 'original';        -- 'original' | 'opening'
  v_opening_date DATE := '2026-04-01';

  v_default_cash TEXT := '1110';
  -- =================================================

  r                RECORD;
  v_advance_id     UUID;
  v_type_id        UUID;
  v_type_code      TEXT;
  v_voucher_id     UUID;
  v_voucher_number TEXT;
  v_reference      TEXT;
  v_voucher_date   DATE;
  v_posted         INTEGER := 0;
  v_total          NUMERIC(15,2) := 0;
BEGIN
  IF NOT v_confirm THEN
    RAISE NOTICE 'Nothing posted. Review the summary below, then set v_confirm := true.';
    RETURN;
  END IF;

  IF v_date_policy NOT IN ('original', 'opening') THEN
    RAISE EXCEPTION 'v_date_policy must be original or opening';
  END IF;

  SELECT id INTO v_advance_id FROM chart_of_accounts WHERE account_code = '2110';
  IF v_advance_id IS NULL THEN
    RAISE EXCEPTION 'Ledger 2110 Patient Advance not found';
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'RECEIPT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'REC' THEN 1 WHEN 'RV' THEN 2 ELSE 3 END
   LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No active RECEIPT voucher type';
  END IF;

  FOR r IN
    -- Rows counted against vouchers per (patient, date, amount) group. Identity
    -- matching would be wrong here: 611 vouchers still carry no link, so
    -- "has no linked voucher" would flag payments that did post.
    WITH ap AS (
      SELECT ap.id, ap.patient_id,
             ap.payment_date::date AS d,
             ap.advance_amount     AS amt,
             COALESCE(ap.is_refund, false) AS is_refund,
             COALESCE(ap.bank_account_id,
                      (SELECT id FROM chart_of_accounts WHERE account_code = v_default_cash))
               AS account_id
        FROM advance_payment ap
       WHERE COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
         AND ap.patient_id IS NOT NULL
         AND ap.advance_amount IS NOT NULL
         AND date_trunc('month', ap.payment_date::date)::date
               BETWEEN v_from_period AND v_upto_period
    ),
    ap_g AS (
      SELECT patient_id, d, amt, is_refund, account_id, count(*) AS rows_n
        FROM ap GROUP BY 1,2,3,4,5
    ),
    v_g AS (
      SELECT v.patient_id, v.voucher_date AS d, v.total_amount AS amt,
             count(DISTINCT v.id) AS vouchers_n
        FROM vouchers v
        JOIN voucher_entries e   ON e.voucher_id = v.id
        JOIN chart_of_accounts a ON a.id = e.account_id
       WHERE a.account_code = '2110'
         AND v.status = 'AUTHORISED'
         AND COALESCE(v.reference_number,'') NOT LIKE '%-CORR-%'
       GROUP BY 1,2,3
    )
    SELECT date_trunc('month', g.d)::date AS period,
           g.account_id,
           round(sum((g.rows_n - COALESCE(w.vouchers_n, 0))
                     * CASE WHEN g.is_refund THEN -g.amt ELSE g.amt END), 2) AS amount
      FROM ap_g g
      LEFT JOIN v_g w
        ON w.patient_id = g.patient_id AND w.d = g.d AND w.amt = g.amt
     WHERE g.rows_n > COALESCE(w.vouchers_n, 0)
       AND g.account_id IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 1, 2
  LOOP
    CONTINUE WHEN r.amount IS NULL OR r.amount = 0;

    v_reference := 'MISSING-RCT-' || to_char(r.period, 'YYYY-MM') || '-'
                   || COALESCE((SELECT account_code FROM chart_of_accounts
                                 WHERE id = r.account_id), 'UNK');
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM vouchers
       WHERE reference_number = v_reference AND status <> 'CANCELLED');

    v_voucher_date := CASE WHEN v_date_policy = 'opening'
                           THEN v_opening_date
                           ELSE (r.period + INTERVAL '1 month' - INTERVAL '1 day')::date
                      END;

    v_voucher_id := gen_random_uuid();
    v_voucher_number := generate_voucher_number(v_type_code);

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, status, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_number, v_type_id, v_voucher_date, v_reference,
      'Receipts collected in ' || to_char(r.period, 'Mon YYYY')
        || ' that were never posted to the ledger',
      abs(r.amount), 'AUTHORISED', 'missing-receipt-backfill', NOW(), NOW()
    );

    IF r.amount > 0 THEN
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration, debit_amount, credit_amount,
        entry_order, created_at
      ) VALUES
        (gen_random_uuid(), v_voucher_id, r.account_id,
         'Unposted receipts - ' || to_char(r.period,'Mon YYYY'), r.amount, 0, 1, NOW()),
        (gen_random_uuid(), v_voucher_id, v_advance_id,
         'Unposted receipts - ' || to_char(r.period,'Mon YYYY'), 0, r.amount, 2, NOW());
    ELSE
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration, debit_amount, credit_amount,
        entry_order, created_at
      ) VALUES
        (gen_random_uuid(), v_voucher_id, v_advance_id,
         'Unposted refunds - ' || to_char(r.period,'Mon YYYY'), -r.amount, 0, 1, NOW()),
        (gen_random_uuid(), v_voucher_id, r.account_id,
         'Unposted refunds - ' || to_char(r.period,'Mon YYYY'), 0, -r.amount, 2, NOW());
    END IF;

    v_posted := v_posted + 1;
    v_total  := v_total + r.amount;
  END LOOP;

  RAISE NOTICE 'Done. % vouchers, net Rs % posted.', v_posted, v_total;
END;
$$;

-- Summary: what is still missing, by month. Serves as the preview before
-- posting and the verification afterwards - once posted these go to zero.
WITH ap AS (
  SELECT ap.patient_id, ap.payment_date::date AS d, ap.advance_amount AS amt,
         COALESCE(ap.is_refund, false) AS is_refund
    FROM advance_payment ap
   WHERE COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
     AND ap.patient_id IS NOT NULL
     AND ap.advance_amount IS NOT NULL
     AND ap.payment_date::date < '2026-04-01'
),
ap_g AS (
  SELECT patient_id, d, amt, is_refund, count(*) AS rows_n
    FROM ap GROUP BY 1,2,3,4
),
v_g AS (
  SELECT v.patient_id, v.voucher_date AS d, v.total_amount AS amt,
         count(DISTINCT v.id) AS vouchers_n
    FROM vouchers v
    JOIN voucher_entries e   ON e.voucher_id = v.id
    JOIN chart_of_accounts a ON a.id = e.account_id
   WHERE a.account_code = '2110'
     AND v.status = 'AUTHORISED'
     AND COALESCE(v.reference_number,'') NOT LIKE '%-CORR-%'
   GROUP BY 1,2,3
)
SELECT date_trunc('month', g.d)::date                                   AS period,
       sum(g.rows_n - COALESCE(w.vouchers_n, 0))                        AS unposted_rows,
       round(sum((g.rows_n - COALESCE(w.vouchers_n, 0))
                 * CASE WHEN g.is_refund THEN -g.amt ELSE g.amt END), 2) AS unposted_amount
  FROM ap_g g
  LEFT JOIN v_g w
    ON w.patient_id = g.patient_id AND w.d = g.d AND w.amt = g.amt
 WHERE g.rows_n > COALESCE(w.vouchers_n, 0)
 GROUP BY 1
 ORDER BY 1;

-- To undo:
--   UPDATE vouchers SET status = 'CANCELLED'
--    WHERE reference_number LIKE 'MISSING-RCT-%' AND status <> 'CANCELLED';
