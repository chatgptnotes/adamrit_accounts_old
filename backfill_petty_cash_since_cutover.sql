
-- ###########################################################
-- Post the petty cash vouchers written since the cutover.
--
-- 29 vouchers, 25-26 July, about Rs 36,600. These are unaffected by the Yojna
-- date question: payment_vouchers.voucher_date is a real DATE column, not text,
-- so their dates are certain.
--
-- Each posts on its OWN date, not today, so the cash lands in the day it left.
-- Anything on or before 24 July is left alone - Tally carried it and it is
-- inside the opening balances.
--
-- Idempotent. post_one_payment_voucher skips a voucher that already has a live
-- posting, so running this twice cannot double anything.
-- ###########################################################

CREATE TEMP TABLE petty_backfill AS
SELECT pv.id, pv.voucher_no, pv.voucher_date, pv.amount,
       public.post_one_payment_voucher(pv.id) AS posted_as
  FROM payment_vouchers pv
 WHERE pv.voucher_date > DATE '2026-07-24'
   AND COALESCE(pv.amount, 0) > 0
   AND EXISTS (SELECT 1 FROM payment_voucher_lines l WHERE l.voucher_id = pv.id)
 ORDER BY pv.voucher_date, pv.voucher_no;

-- What posted, what it came to, and whether each voucher balances.
SELECT b.voucher_date,
       b.voucher_no,
       b.posted_as,
       b.amount            AS header_amount,
       v.total_amount      AS posted_amount,
       round(COALESCE((SELECT sum(e.debit_amount) - sum(e.credit_amount)
                         FROM voucher_entries e WHERE e.voucher_id = v.id), 0), 2)
                           AS difference,
       CASE WHEN b.posted_as IS NULL THEN 'skipped - already posted or no usable lines'
            WHEN round(b.amount, 2) <> round(v.total_amount, 2)
              THEN 'POSTED, but the header disagrees with its own lines'
            ELSE 'posted' END AS state
  FROM petty_backfill b
  LEFT JOIN vouchers v ON v.voucher_number = b.posted_as
 ORDER BY b.voucher_date, b.voucher_no;

-- The totals, and confirmation the books still balance.
SELECT count(*) FILTER (WHERE posted_as IS NOT NULL)          AS vouchers_posted,
       count(*) FILTER (WHERE posted_as IS NULL)              AS skipped,
       round(COALESCE(sum(amount) FILTER (WHERE posted_as IS NOT NULL), 0), 2)
                                                              AS cash_now_recorded,
       (SELECT round(COALESCE(sum(e.debit_amount) - sum(e.credit_amount), 0), 2)
          FROM voucher_entries e
          JOIN vouchers v2 ON v2.id = e.voucher_id AND v2.status <> 'CANCELLED')
                                                              AS all_vouchers_difference
  FROM petty_backfill;
