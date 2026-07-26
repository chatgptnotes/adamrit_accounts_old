-- Map suppliers to their creditor ledgers, but only where the match is safe.
--
-- Two bands are applied:
--   1. exact name       - the supplier and the ledger are spelled identically
--   2. unambiguous prefix - exactly one creditor ledger begins with the
--      supplier's name, and that name is at least 6 characters
--
-- Everything else is left alone for a human to decide. The weaker bands are
-- skipped deliberately: a short name matching inside a longer one produces
-- suggestions that read plausibly and are wrong, which is how the panel
-- exercise nearly pointed nineteen insurance TPAs at an expense account.
--
-- The 6-character floor exists because a supplier called 'A1' would otherwise
-- prefix-match 'A1 COOLERS', 'A1 SURGICALS' and anything else beginning with
-- those two characters. Requiring exactly one candidate guards the same risk
-- from the other side.
--
-- Only Sundry Creditors ledgers are considered, so nothing outside the
-- creditor group can be selected however well the name reads.
--
-- To undo:
--   UPDATE suppliers SET ledger_account_id = NULL
--    WHERE ledger_account_id IS NOT NULL;   -- or scope by supplier_name

-- Band 1: exact name.
UPDATE public.suppliers s
   SET ledger_account_id = a.id,
       updated_at        = now()
  FROM public.chart_of_accounts a
 WHERE s.ledger_account_id IS NULL
   AND a.is_active = true
   AND lower(btrim(a.account_group)) = 'sundry creditors'
   AND lower(btrim(a.account_name))  = lower(btrim(s.supplier_name));

-- Band 2: exactly one creditor ledger starts with the supplier's name.
UPDATE public.suppliers s
   SET ledger_account_id = c.only_match,
       updated_at        = now()
  FROM (
    SELECT s2.id AS supplier_id,
           min(a.id) FILTER (WHERE true) AS only_match,
           count(*)                      AS candidates
      FROM public.suppliers s2
      JOIN public.chart_of_accounts a
        ON a.is_active = true
       AND lower(btrim(a.account_group)) = 'sundry creditors'
       AND a.account_name ILIKE btrim(s2.supplier_name) || '%'
     WHERE s2.ledger_account_id IS NULL
       AND length(btrim(s2.supplier_name)) >= 6
     GROUP BY s2.id
    HAVING count(*) = 1
  ) c
 WHERE s.id = c.supplier_id
   AND s.ledger_account_id IS NULL;


-- What was applied, and what is still waiting on a decision.
SELECT CASE WHEN s.ledger_account_id IS NULL THEN 'still needs a ledger' ELSE 'mapped' END AS state,
       count(*) AS suppliers,
       string_agg(CASE WHEN s.ledger_account_id IS NULL THEN s.supplier_name END,
                  ', ' ORDER BY s.supplier_name) AS which
  FROM public.suppliers s
 GROUP BY 1
 ORDER BY 1;
