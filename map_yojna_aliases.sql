-- Link the short scheme names to the ledgers their long names already use.
--
-- The safe-match pass linked nothing, because nothing was left to match by
-- name. Reading what it could not resolve shows why: three of the five are not
-- missing schemes at all, they are abbreviations of schemes already mapped.
--
--   PMJAY      5 bills   Rs 3,00,584  same scheme as Ayushman Bharat - PM-JAY
--   AB-PMJAY   5 bills   Rs   53,600  same scheme again
--   MJPJAY     5 bills   Rs 1,53,200  same scheme as Mahatma Jyotirao Phule
--
-- corporate_name on a Yojna bill is copied straight from the patient record
-- (CorporateBill.tsx:75,145), so these short forms live in patients.corporate
-- and will keep appearing on new bills. They belong in the corporate master -
-- their absence is a gap in the master, not a reason to invent a ledger.
--
-- Adding them also fixes the payer split on ordinary bills, which resolves the
-- same way, so this is not only about Yojna.
--
-- private and Private are left alone deliberately. They are not schemes:
-- 'Private' is the literal fallback when a patient has no corporate at all.
-- Those Rs 5,90,797 belong on the patient's own ledger, which is where the
-- accrual already puts them. That is correct, not unfinished.
--
-- Each alias copies the ledger from its long-named parent, matched on the
-- distinguishing words rather than typed in, so a renamed ledger stays correct.

INSERT INTO public.corporate (name, description, ledger_account_id)
SELECT v.alias,
       'Short form of ' || c.name || ', added so claims reach the same ledger',
       c.ledger_account_id
  FROM (VALUES
         ('PMJAY',    '%pradhan mantri jan arogya%'),
         ('AB-PMJAY', '%pradhan mantri jan arogya%'),
         ('MJPJAY',   '%jyotirao phule%')
       ) AS v(alias, parent_pattern)
  JOIN LATERAL (
    SELECT c2.name, c2.ledger_account_id
      FROM public.corporate c2
     WHERE lower(btrim(c2.name)) LIKE v.parent_pattern
       AND c2.ledger_account_id IS NOT NULL
     ORDER BY length(c2.name)
     LIMIT 1
  ) c ON true
 WHERE NOT EXISTS (SELECT 1 FROM public.corporate x
                    WHERE lower(btrim(x.name)) = lower(v.alias))
ON CONFLICT (name) DO NOTHING;

-- An alias that already existed without a ledger gets one the same way.
UPDATE public.corporate a
   SET ledger_account_id = c.ledger_account_id,
       updated_at = now()
  FROM (VALUES
         ('PMJAY',    '%pradhan mantri jan arogya%'),
         ('AB-PMJAY', '%pradhan mantri jan arogya%'),
         ('MJPJAY',   '%jyotirao phule%')
       ) AS v(alias, parent_pattern)
  JOIN LATERAL (
    SELECT c2.ledger_account_id
      FROM public.corporate c2
     WHERE lower(btrim(c2.name)) LIKE v.parent_pattern
       AND c2.ledger_account_id IS NOT NULL
     ORDER BY length(c2.name)
     LIMIT 1
  ) c ON true
 WHERE lower(btrim(a.name)) = lower(v.alias)
   AND a.ledger_account_id IS NULL;


-- ###########################################################
-- Where every Yojna claim now lands. One result set.
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
  SELECT p.*, m.ledger_code, m.ledger_name
    FROM per_scheme p
    LEFT JOIN LATERAL (
      SELECT a.account_code AS ledger_code, a.account_name AS ledger_name
        FROM corporate c
        JOIN chart_of_accounts a ON a.id = c.ledger_account_id
       WHERE lower(btrim(c.name)) = lower(btrim(p.scheme))
       LIMIT 1
    ) m ON true
)
SELECT CASE WHEN r.ledger_code IS NOT NULL THEN 'A. claims the scheme'
            WHEN lower(r.scheme) IN ('private', '') THEN 'B. private - the patient, correctly'
            ELSE 'C. STILL UNRESOLVED' END AS section,
       CASE WHEN r.scheme = '' THEN '(no scheme named)' ELSE r.scheme END AS scheme,
       r.total AS amount,
       r.bills,
       COALESCE(r.ledger_code || ' ' || r.ledger_name, 'the patient carries it') AS lands_on
  FROM resolved r
UNION ALL
SELECT 'D. totals',
       CASE WHEN r.ledger_code IS NOT NULL THEN 'claims a scheme'
            WHEN lower(r.scheme) IN ('private', '') THEN 'the patient, correctly'
            ELSE 'STILL UNRESOLVED' END,
       round(sum(r.total), 2), sum(r.bills)::BIGINT,
       count(*)::TEXT || ' scheme names'
  FROM resolved r
 GROUP BY 2
 ORDER BY 1, 3 DESC NULLS LAST;
