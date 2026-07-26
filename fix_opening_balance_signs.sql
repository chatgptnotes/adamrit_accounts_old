-- Close the 64,41,538.58 gap in the imported opening balances, but only if a
-- sign correction genuinely explains it.
--
-- The imported opening balances are credit-heavy by 64,41,538.58. Every Adamrit
-- voucher nets to zero, and the P&L ledgers carry no opening at all, so the gap
-- came in with the Tally import on 25 July. It was invisible until the Tally
-- merge was switched off, because the merge was displaying Tally's own balanced
-- closing figures instead.
--
-- A dr/cr marker recorded the wrong way round moves the total by TWICE the
-- balance, which is the usual cause of a gap like this. Candidates are ledgers
-- whose marker contradicts the nature of their account type: a liability or
-- income ledger marked DR, or an asset or expense ledger marked CR.
--
-- IMPORTANT: contradicting the natural sign is not proof of error. A debtor can
-- legitimately sit in credit when a patient has paid in advance. So this script
-- flips nothing unless doing so closes the gap to zero exactly. If it does not,
-- it reports what it found and changes nothing - a partial correction would
-- make the remaining difference harder to trace, not easier.
--
-- To undo, flip the marker back on the ledgers listed as changed.

DO $$
DECLARE
  v_gap_before  NUMERIC(15,2);
  v_gap_after   NUMERIC(15,2);
  v_candidates  INTEGER;
  v_effect      NUMERIC(15,2);
BEGIN
  SELECT round(sum(CASE WHEN upper(COALESCE(opening_balance_type,'DR')) = 'CR'
                        THEN -COALESCE(opening_balance,0)
                        ELSE  COALESCE(opening_balance,0) END), 2)
    INTO v_gap_before
    FROM chart_of_accounts;

  -- Ledgers whose marker contradicts the nature of their type.
  CREATE TEMP TABLE sign_candidates AS
  SELECT id, account_code, account_name, account_type,
         opening_balance_type AS current_marker,
         opening_balance,
         CASE WHEN upper(COALESCE(opening_balance_type,'DR')) = 'CR' THEN 'DR' ELSE 'CR' END
           AS corrected_marker,
         -- flipping moves the total by twice the balance, in the opposite direction
         CASE WHEN upper(COALESCE(opening_balance_type,'DR')) = 'CR'
              THEN  2 * COALESCE(opening_balance,0)
              ELSE -2 * COALESCE(opening_balance,0) END AS effect_on_gap
    FROM chart_of_accounts
   WHERE COALESCE(opening_balance,0) <> 0
     AND (
       (account_type IN ('LIABILITIES','CURRENT_LIABILITIES','LONG_TERM_LIABILITIES',
                         'EQUITY','INCOME','DIRECT_INCOME','INDIRECT_INCOME')
        AND upper(COALESCE(opening_balance_type,'DR')) = 'DR')
       OR
       (account_type IN ('ASSETS','CURRENT_ASSETS','FIXED_ASSETS',
                         'EXPENSES','DIRECT_EXPENSES','INDIRECT_EXPENSES')
        AND upper(COALESCE(opening_balance_type,'DR')) = 'CR')
     );

  SELECT count(*), COALESCE(round(sum(effect_on_gap), 2), 0)
    INTO v_candidates, v_effect
    FROM sign_candidates;

  v_gap_after := round(v_gap_before + v_effect, 2);

  RAISE NOTICE 'gap before %, candidates %, their effect %, gap after %',
    v_gap_before, v_candidates, v_effect, v_gap_after;

  IF v_candidates = 0 THEN
    RAISE NOTICE 'No ledger contradicts its natural sign. The gap is not a sign error - nothing changed.';
    RETURN;
  END IF;

  IF v_gap_after <> 0 THEN
    RAISE NOTICE 'Flipping these would leave % rather than closing the gap. Nothing changed.', v_gap_after;
    RETURN;
  END IF;

  UPDATE chart_of_accounts a
     SET opening_balance_type = c.corrected_marker,
         updated_at = now()
    FROM sign_candidates c
   WHERE a.id = c.id;

  RAISE NOTICE 'Corrected % ledgers. Opening balances now balance.', v_candidates;
END;
$$;

-- What was found, whether or not it was applied, and where the gap stands.
SELECT c.account_code,
       c.account_name,
       c.account_type,
       c.current_marker,
       c.corrected_marker,
       round(c.opening_balance, 2)  AS opening_balance,
       round(c.effect_on_gap, 2)    AS effect_on_gap,
       (SELECT round(sum(CASE WHEN upper(COALESCE(opening_balance_type,'DR')) = 'CR'
                              THEN -COALESCE(opening_balance,0)
                              ELSE  COALESCE(opening_balance,0) END), 2)
          FROM chart_of_accounts)   AS gap_now
  FROM sign_candidates c
 ORDER BY abs(c.effect_on_gap) DESC;
