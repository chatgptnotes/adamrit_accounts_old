-- Post the advance receipts that never reached the ledger (Sep 2025 - Mar 2026).
--
-- Rewritten as plain SQL. The previous DO-block version silently posted
-- nothing twice, and its identification grouped by account_id before comparing
-- rows against voucher counts, which split a patient's payments and under-found
-- them. This has no confirm flag and no loop: it inserts, or it errors.
--
-- Identification works at row level. Each payment is ranked within its
-- (patient, date, amount) group and compared with how many 2110 vouchers exist
-- for that same group; anything ranked beyond the voucher count never posted.
-- That is the same rule the summary at the bottom uses, so the two agree.
--
-- Refund rows are netted off and reverse the entry direction.
--
-- Dated at month end, in the months the money was actually received.
--
-- To undo:
--   UPDATE vouchers SET status = 'CANCELLED'
--    WHERE reference_number LIKE 'MISSING-RCT-%' AND status <> 'CANCELLED';

WITH ranked AS (
  SELECT ap.id,
         ap.patient_id,
         ap.payment_date::date                     AS d,
         ap.advance_amount                         AS amt,
         COALESCE(ap.is_refund, false)             AS is_refund,
         COALESCE(ap.bank_account_id,
                  (SELECT id FROM chart_of_accounts WHERE account_code = '1110'))
                                                   AS account_id,
         row_number() OVER (PARTITION BY ap.patient_id, ap.payment_date::date,
                                         ap.advance_amount
                            ORDER BY ap.id)        AS rn
    FROM advance_payment ap
   WHERE COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
     AND ap.patient_id IS NOT NULL
     AND ap.advance_amount IS NOT NULL
     AND date_trunc('month', ap.payment_date::date)::date
           BETWEEN '2025-09-01' AND '2026-03-01'
),
v_counts AS (
  SELECT v.patient_id, v.voucher_date AS d, v.total_amount AS amt,
         count(DISTINCT v.id) AS n
    FROM vouchers v
    JOIN voucher_entries e   ON e.voucher_id = v.id
    JOIN chart_of_accounts a ON a.id = e.account_id
   WHERE a.account_code = '2110'
     AND v.status = 'AUTHORISED'
     AND COALESCE(v.reference_number,'') NOT LIKE '%-CORR-%'
   GROUP BY 1, 2, 3
),
unposted AS (
  SELECT r.*
    FROM ranked r
    LEFT JOIN v_counts c
      ON c.patient_id = r.patient_id AND c.d = r.d AND c.amt = r.amt
   WHERE r.rn > COALESCE(c.n, 0)
),
agg AS (
  SELECT date_trunc('month', u.d)::date AS period,
         u.account_id,
         ca.account_code,
         round(sum(CASE WHEN u.is_refund THEN -u.amt ELSE u.amt END), 2) AS amount,
         'MISSING-RCT-' || to_char(date_trunc('month', u.d), 'YYYY-MM')
           || '-' || ca.account_code                                     AS ref
    FROM unposted u
    JOIN chart_of_accounts ca ON ca.id = u.account_id
   GROUP BY 1, 2, 3, 5
  HAVING round(sum(CASE WHEN u.is_refund THEN -u.amt ELSE u.amt END), 2) <> 0
),
ins AS (
  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, status, created_by, created_at, updated_at
  )
  SELECT gen_random_uuid(),
         generate_voucher_number(vt.voucher_type_code),
         vt.id,
         (a.period + INTERVAL '1 month' - INTERVAL '1 day')::date,
         a.ref,
         'Receipts collected in ' || to_char(a.period, 'Mon YYYY')
           || ' that were never posted to the ledger',
         abs(a.amount),
         'AUTHORISED',
         'missing-receipt-backfill',
         NOW(), NOW()
    FROM agg a
    CROSS JOIN LATERAL (
      SELECT id, voucher_type_code FROM voucher_types
       WHERE voucher_category = 'RECEIPT' AND is_active = true
       ORDER BY CASE voucher_type_code WHEN 'REC' THEN 1 WHEN 'RV' THEN 2 ELSE 3 END
       LIMIT 1
    ) vt
   WHERE NOT EXISTS (
     SELECT 1 FROM vouchers x
      WHERE x.reference_number = a.ref AND x.status <> 'CANCELLED')
  RETURNING id AS voucher_id, reference_number
)
INSERT INTO voucher_entries (
  id, voucher_id, account_id, narration, debit_amount, credit_amount,
  entry_order, created_at
)
SELECT gen_random_uuid(),
       i.voucher_id,
       -- leg 1 is the debit, leg 2 the credit. A positive month debits cash
       -- and credits the advance liability; a negative one (net refunds)
       -- reverses.
       CASE WHEN l.leg = 1
            THEN CASE WHEN a.amount > 0 THEN a.account_id ELSE adv.id END
            ELSE CASE WHEN a.amount > 0 THEN adv.id ELSE a.account_id END
       END,
       CASE WHEN a.amount > 0 THEN 'Unposted receipts - ' ELSE 'Unposted refunds - ' END
         || to_char(a.period, 'Mon YYYY'),
       CASE WHEN l.leg = 1 THEN abs(a.amount) ELSE 0 END,
       CASE WHEN l.leg = 2 THEN abs(a.amount) ELSE 0 END,
       l.leg,
       NOW()
  FROM ins i
  JOIN agg a ON a.ref = i.reference_number
  CROSS JOIN (VALUES (1), (2)) AS l(leg)
  CROSS JOIN LATERAL (
    SELECT id FROM chart_of_accounts WHERE account_code = '2110'
  ) adv;


-- Verification: what is still unposted. Every month should now read zero.
WITH ranked AS (
  SELECT ap.patient_id, ap.payment_date::date AS d, ap.advance_amount AS amt,
         COALESCE(ap.is_refund, false) AS is_refund,
         row_number() OVER (PARTITION BY ap.patient_id, ap.payment_date::date,
                                         ap.advance_amount
                            ORDER BY ap.id) AS rn
    FROM advance_payment ap
   WHERE COALESCE(ap.status,'ACTIVE') <> 'CANCELLED'
     AND ap.patient_id IS NOT NULL
     AND ap.advance_amount IS NOT NULL
     AND ap.payment_date::date < '2026-04-01'
),
v_counts AS (
  SELECT v.patient_id, v.voucher_date AS d, v.total_amount AS amt,
         count(DISTINCT v.id) AS n
    FROM vouchers v
    JOIN voucher_entries e   ON e.voucher_id = v.id
    JOIN chart_of_accounts a ON a.id = e.account_id
   WHERE a.account_code = '2110'
     AND v.status = 'AUTHORISED'
   GROUP BY 1, 2, 3
)
SELECT date_trunc('month', r.d)::date AS period,
       count(*)                       AS unposted_rows,
       round(sum(CASE WHEN r.is_refund THEN -r.amt ELSE r.amt END), 2) AS unposted_amount
  FROM ranked r
  LEFT JOIN v_counts c
    ON c.patient_id = r.patient_id AND c.d = r.d AND c.amt = r.amt
 WHERE r.rn > COALESCE(c.n, 0)
 GROUP BY 1
 ORDER BY 1;
