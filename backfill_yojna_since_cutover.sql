
-- ###########################################################
-- Post the Yojna claims raised since the cutover.
--
-- 17 bills, about Rs 4,69,827, dated 25-26 July. Everything on or before the
-- 24th is inside the Tally opening balances and is left alone - that is
-- Rs 1,19,45,610 across 259 bills, and posting it would double it.
--
-- The date used is the resolved one, so a bill whose own date is unreadable or
-- in the future is placed by its visit instead. That is why this catches 17
-- bills rather than the 10 whose written date happens to be readable.
--
-- Idempotent. post_one_yojna_bill skips a bill that already has a live posting,
-- and skips any whose visit already accrued a final bill, so nothing doubles.
-- ###########################################################

CREATE TEMP TABLE yojna_backfill AS
SELECT y.id, y.invoice_no, y.corporate_name, y.total_amount,
       public.yojna_voucher_date(y.date_of_invoice::TEXT,
                                 y.date_of_discharge::TEXT,
                                 y.visit_id) AS resolved_date,
       public.post_one_yojna_bill(y.id)      AS posted_as
  FROM yojna_bills y
 WHERE COALESCE(y.total_amount, 0) > 0
   AND public.yojna_voucher_date(y.date_of_invoice::TEXT,
                                 y.date_of_discharge::TEXT,
                                 y.visit_id) > DATE '2026-07-24';

-- Each claim, where it landed, and whether it balances.
SELECT b.resolved_date,
       b.invoice_no,
       b.posted_as,
       b.total_amount,
       a.account_code || ' ' || a.account_name AS claimed_against,
       round(COALESCE((SELECT sum(e2.debit_amount) - sum(e2.credit_amount)
                         FROM voucher_entries e2 WHERE e2.voucher_id = v.id), 0), 2)
                                               AS difference,
       CASE WHEN b.posted_as IS NULL
              THEN 'skipped - already posted, or the final bill accrued it'
            ELSE 'posted' END                  AS state
  FROM yojna_backfill b
  LEFT JOIN vouchers v       ON v.voucher_number = b.posted_as
  LEFT JOIN voucher_entries e ON e.voucher_id = v.id AND e.entry_order = 1
  LEFT JOIN chart_of_accounts a ON a.id = e.account_id
 ORDER BY b.resolved_date, b.invoice_no;

-- Totals, and the books.
SELECT count(*) FILTER (WHERE posted_as IS NOT NULL)  AS claims_posted,
       count(*) FILTER (WHERE posted_as IS NULL)      AS skipped,
       round(COALESCE(sum(total_amount) FILTER (WHERE posted_as IS NOT NULL), 0), 2)
                                                      AS receivable_now_recorded,
       (SELECT round(COALESCE(sum(e.debit_amount) - sum(e.credit_amount), 0), 2)
          FROM voucher_entries e
          JOIN vouchers v2 ON v2.id = e.voucher_id AND v2.status <> 'CANCELLED')
                                                      AS all_vouchers_difference
  FROM yojna_backfill;
