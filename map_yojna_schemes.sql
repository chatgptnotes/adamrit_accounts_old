-- Link the Yojna schemes to the debtor ledgers they should claim against.
--
-- The accrual debits corporate.ledger_account_id for the scheme named on the
-- bill. Unmapped, the patient carries the claim - the income is recorded but
-- the receivable sits on the wrong party and the remittance settles nothing.
--
-- SAFE MATCHES ONLY. A scheme is linked when exactly one active Sundry Debtors
-- ledger carries the same name, ignoring case and surrounding spaces. Where two
-- ledgers could match, nothing is linked - guessing between them would put a
-- claim on the wrong debtor, which is worse than leaving it visible. Nothing
-- is created and no ledger is altered; only the empty link is filled in.
--
-- Same rule used for the suppliers earlier. What it cannot resolve is listed at
-- the bottom for you to decide, and can be linked by hand with:
--     UPDATE corporate SET ledger_account_id =
--       (SELECT id FROM chart_of_accounts WHERE account_code = '<code>')
--      WHERE name = '<scheme>';

-- Record the state before, so the report can show what this actually changed.
CREATE TEMP TABLE before_mapping AS
SELECT c.id, c.name, c.ledger_account_id
  FROM corporate c;

UPDATE corporate c
   SET ledger_account_id = m.id
  FROM (
    SELECT lower(btrim(a.account_name)) AS key,
           (array_agg(a.id ORDER BY a.account_code))[1] AS id
      FROM chart_of_accounts a
     WHERE a.is_active
       AND lower(btrim(a.account_group)) = 'sundry debtors'
     GROUP BY lower(btrim(a.account_name))
    HAVING count(*) = 1          -- one candidate only; ambiguity is left alone
  ) m
 WHERE c.ledger_account_id IS NULL
   AND lower(btrim(c.name)) = m.key;


-- ###########################################################
-- What happened, in one result set.
-- ###########################################################

WITH per_scheme AS (
  SELECT btrim(COALESCE(y.corporate_name, '')) AS scheme,
         count(*) AS bills,
         round(sum(y.total_amount), 2) AS total
    FROM yojna_bills y
   WHERE COALESCE(y.total_amount, 0) > 0
   GROUP BY btrim(COALESCE(y.corporate_name, ''))
),
resolved AS (
  SELECT p.*, m.ledger_code, m.ledger_name, m.company, m.was_null
    FROM per_scheme p
    LEFT JOIN LATERAL (
      SELECT a.account_code AS ledger_code, a.account_name AS ledger_name,
             co.company_name AS company,
             (SELECT b.ledger_account_id IS NULL FROM before_mapping b
               WHERE b.id = c.id) AS was_null
        FROM corporate c
        JOIN chart_of_accounts a ON a.id = c.ledger_account_id
        LEFT JOIN companies co ON co.id = a.company_id
       WHERE lower(btrim(c.name)) = lower(btrim(p.scheme))
       LIMIT 1
    ) m ON true
),
newly AS (
  SELECT 'A. linked just now' AS section, r.scheme AS item, r.total AS amount,
         r.bills, r.ledger_code || ' ' || r.ledger_name
           || COALESCE(' (' || r.company || ')', '') AS detail
    FROM resolved r WHERE r.ledger_code IS NOT NULL AND r.was_null
),
already AS (
  SELECT 'B. already linked' AS section, r.scheme, r.total, r.bills,
         r.ledger_code || ' ' || r.ledger_name
           || COALESCE(' (' || r.company || ')', '')
    FROM resolved r WHERE r.ledger_code IS NOT NULL AND NOT r.was_null
),
stuck AS (
  SELECT 'C. still unmapped - the patient would carry these' AS section,
         CASE WHEN r.scheme = '' THEN '(no scheme named on the bill)' ELSE r.scheme END,
         r.total, r.bills,
         CASE WHEN NOT EXISTS (SELECT 1 FROM corporate c
                                WHERE lower(btrim(c.name)) = lower(btrim(r.scheme)))
                THEN 'not in the corporate master'
              WHEN (SELECT count(*) FROM chart_of_accounts a
                     WHERE a.is_active
                       AND lower(btrim(a.account_group)) = 'sundry debtors'
                       AND lower(btrim(a.account_name)) = lower(btrim(r.scheme))) > 1
                THEN 'several ledgers share this name - pick one by hand'
              ELSE 'no debtor ledger of this name - one must be created' END
    FROM resolved r WHERE r.ledger_code IS NULL
),
totals AS (
  SELECT 'D. totals' AS section,
         CASE WHEN r.ledger_code IS NOT NULL THEN 'claimable against a scheme'
              ELSE 'would land on the patient' END,
         round(sum(r.total), 2), sum(r.bills)::BIGINT,
         count(*)::TEXT || ' scheme names'
    FROM resolved r
   GROUP BY (r.ledger_code IS NOT NULL)
)
SELECT * FROM newly
UNION ALL SELECT * FROM already
UNION ALL SELECT * FROM stuck
UNION ALL SELECT * FROM totals
ORDER BY section, amount DESC NULLS LAST;
