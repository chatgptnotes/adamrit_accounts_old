-- Run this at the end of a day when staff have used the new screens.
-- Reads only. It answers one question per section: did the day's real work
-- reach the ledger, and does it hold together.
--
-- Set the date if you are checking a day other than today.

WITH d AS (SELECT CURRENT_DATE AS day),
live AS (
  SELECT v.id, v.voucher_number, v.voucher_date, v.total_amount, v.created_by,
         v.company_id, v.reference_number,
         CASE WHEN v.reference_number LIKE 'OBL-%'     THEN 'Obligation payments'
              WHEN v.reference_number LIKE 'YOJNA-%'   THEN 'Yojna claims'
              WHEN v.reference_number LIKE 'PV-%'      THEN 'Petty cash'
              WHEN v.reference_number LIKE 'IMPLANT-%' THEN 'Implant bills'
              WHEN v.reference_number LIKE 'PHYSIO-%'  THEN 'Physiotherapy'
              WHEN v.reference_number LIKE 'DSALE-%'   THEN 'Direct sales'
              WHEN v.reference_number LIKE 'PHARM-CR-%' THEN 'Pharmacy credit'
              WHEN v.created_by = 'medicine-return'    THEN 'Medicine returns'
              WHEN v.created_by = 'grn-accrual'        THEN 'Pharmacy purchases'
              ELSE 'patient billing and receipts' END AS stream
    FROM vouchers v CROSS JOIN d
   WHERE v.status <> 'CANCELLED' AND v.voucher_date = d.day
),
legs AS (
  SELECT e.voucher_id, count(*) AS entries,
         round(sum(e.debit_amount) - sum(e.credit_amount), 2) AS difference
    FROM voucher_entries e GROUP BY e.voucher_id
)
SELECT 'A. what posted today' AS section, l.stream AS item,
       round(sum(l.total_amount), 2) AS amount,
       count(*)::TEXT || ' vouchers, all balanced: '
         || CASE WHEN bool_and(COALESCE(g.difference, 1) = 0) THEN 'yes' ELSE 'NO' END
         || ', all in a company: '
         || CASE WHEN bool_and(l.company_id IS NOT NULL) THEN 'yes' ELSE 'NO' END AS detail
  FROM live l LEFT JOIN legs g ON g.voucher_id = l.id
 GROUP BY 2

UNION ALL

SELECT 'B. PROBLEM - does not balance', l.voucher_number, g.difference, l.stream
  FROM live l JOIN legs g ON g.voucher_id = l.id WHERE g.difference <> 0

UNION ALL

SELECT 'C. PROBLEM - one leg only', l.voucher_number, l.total_amount, l.stream
  FROM live l JOIN legs g ON g.voucher_id = l.id WHERE g.entries < 2

UNION ALL

SELECT 'D. PROBLEM - posted twice', l.reference_number, round(sum(l.total_amount), 2),
       count(*)::TEXT || ' vouchers: ' || string_agg(l.voucher_number, ', ')
  FROM live l WHERE l.reference_number IS NOT NULL
 GROUP BY l.reference_number HAVING count(*) > 1

UNION ALL

-- Cancellations, which is how an edit or a delete should show up.
SELECT 'E. retired today', COALESCE(v.last_modified_by, 'cancelled'),
       round(sum(v.total_amount), 2), count(*)::TEXT || ' vouchers cancelled'
  FROM vouchers v CROSS JOIN d
 WHERE v.status = 'CANCELLED' AND v.updated_at::DATE = d.day
 GROUP BY 2

UNION ALL

-- Obligations paid, and whether part payments read as partial.
SELECT 'F. obligations settled', s.status,
       round(sum(s.paid_amount), 2), count(*)::TEXT || ' obligations'
  FROM daily_payment_schedule s CROSS JOIN d
 WHERE s.schedule_date = d.day AND COALESCE(s.paid_amount, 0) > 0
 GROUP BY 2

UNION ALL

SELECT 'G. the whole book', 'debits less credits',
       (SELECT round(COALESCE(sum(e.debit_amount) - sum(e.credit_amount), 0), 2)
          FROM voucher_entries e
          JOIN vouchers v2 ON v2.id = e.voucher_id AND v2.status <> 'CANCELLED'),
       'should be 0.00'
 ORDER BY 1, 3 DESC;
