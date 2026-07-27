-- Move nine late-entered pharmacy sales into the period Adamrit owns.
--
-- Nine pharmacy credit sales dated 22 to 24 July were entered on the 26th,
-- worth Rs 4,196. They are real, so cancelling them would lose the income. But
-- they sit before 25 July, which is where the Tally opening balances stop, so
-- as posted they fall behind the opening balance and show in no period at all.
--
-- THE SOURCE ROWS ARE NOT TOUCHED. The sale did happen on 22 July, and the
-- pharmacy record should keep saying so - changing it would falsify what the
-- shop actually did. Only the voucher moves.
--
-- That is the ordinary convention for a closed period: the transaction keeps
-- its date, the posting goes to the first open one. Here that is 25 July, the
-- day Adamrit became the book of record.
--
-- The original date goes into the narration, so the voucher says plainly that
-- it was received earlier and posted at the cutover. Anyone reading the ledger
-- can see both dates without going back to the pharmacy system.
--
-- After the FY 2025-26 squaring these nine are the only live vouchers dated
-- before 25 July, so the condition needs nothing more specific than that.
--
-- TO UNDO: the original dates are recoverable from the narration this adds.

CREATE TEMP TABLE nine_reposted AS
SELECT v.id, v.voucher_number, v.voucher_date AS was_dated, v.total_amount,
       v.narration AS was_narrated
  FROM public.vouchers v
 WHERE v.status <> 'CANCELLED'
   AND v.voucher_date < DATE '2026-07-25';

UPDATE public.vouchers v
   SET voucher_date = DATE '2026-07-25',
       narration = n.was_narrated
                   || ' (received ' || n.was_dated::TEXT || ', posted at the cutover)',
       last_modified_by = 'late-entry-moved-to-cutover',
       updated_at = now()
  FROM nine_reposted n
 WHERE v.id = n.id;


-- ###########################################################
-- What moved, and where the books stand. Reads only from here.
-- ###########################################################

WITH scoped AS (
  SELECT c.id AS company_id, c.company_name, a.id AS account_id,
         CASE WHEN upper(COALESCE(a.opening_balance_type,'DR')) = 'CR'
              THEN -COALESCE(a.opening_balance,0)
              ELSE  COALESCE(a.opening_balance,0) END AS opening
    FROM companies c
    JOIN chart_of_accounts a
      ON (a.company_id = c.id OR a.company_id IS NULL) AND a.is_active
),
moved AS (
  SELECT v.company_id, e.account_id,
         sum(e.debit_amount) - sum(e.credit_amount) AS net
    FROM voucher_entries e
    JOIN vouchers v ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
   GROUP BY v.company_id, e.account_id
)
SELECT 'A. moved to 25 July' AS section,
       n.voucher_number || '  was ' || n.was_dated::TEXT AS item,
       round(n.total_amount, 2) AS amount,
       left(n.was_narrated, 55) AS detail
  FROM nine_reposted n

UNION ALL

SELECT 'B. total moved', 'late entry, now in the open period',
       round(sum(n.total_amount), 2),
       count(*)::TEXT || ' vouchers'
  FROM nine_reposted n

UNION ALL

SELECT 'C. earliest live voucher now', 'should be 2026-07-25',
       NULL,
       COALESCE(min(v.voucher_date)::TEXT, 'none live')
  FROM vouchers v WHERE v.status <> 'CANCELLED'

UNION ALL

SELECT 'D. per company', s.company_name,
       round(sum(s.opening) + COALESCE(sum(m.net), 0), 2),
       CASE WHEN abs(sum(s.opening) + COALESCE(sum(m.net), 0)) < 0.005
            THEN 'balanced' ELSE 'OUT OF BALANCE' END
  FROM scoped s
  LEFT JOIN moved m ON m.account_id = s.account_id AND m.company_id = s.company_id
 GROUP BY s.company_name

UNION ALL

SELECT 'E. the whole book', 'debits less credits',
       (SELECT round(COALESCE(sum(e.debit_amount) - sum(e.credit_amount), 0), 2)
          FROM voucher_entries e
          JOIN vouchers v2 ON v2.id = e.voucher_id AND v2.status <> 'CANCELLED'),
       'should be 0.00'
 ORDER BY 1, 3 DESC NULLS LAST;
