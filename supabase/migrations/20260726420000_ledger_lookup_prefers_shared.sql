-- Match a ledger name to the shared ledger first, and repair the 13 petty cash
-- vouchers that straddled.
--
-- THE BUG IS MINE. adamrit_ledger_by_name picks any active ledger with a
-- matching name, ordered by account code, with no regard to company. The chart
-- holds one copy of most names per company, so a petty cash debit landed on a
-- company-owned ledger while its credit - 1110 Cash in Hand, which is shared -
-- stayed shared. One leg in one company's books, the other in all four.
--
-- A company's balance is its own ledgers plus every shared one, so that voucher
-- balances only for the company that owns the debit. The other three pick up
-- the shared credit with nothing against it. Thirteen vouchers, 2,750, all
-- Ayushman Nagpur petty cash from the backfill.
--
-- WHY SHARED FIRST AND NOT THE VOUCHER'S COMPANY. Preferring the voucher's own
-- company sounds more correct and does not fix this: the cash leg would still
-- be shared, because 1110 has no per-company copy, and the voucher would still
-- straddle. This chart keeps party ledgers per company and operational ledgers
-- - cash, banks, income, purchases - shared. Matching that, so both legs of a
-- payment land in the same space, is what actually balances.
--
-- Genuinely per-company ledgers are unaffected: they have no shared copy, so
-- the fallback to a company's own row still finds them.

CREATE OR REPLACE FUNCTION public.adamrit_ledger_by_name(
  p_name          TEXT,
  p_fallback_code TEXT
) RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NOT NULL THEN
    SELECT a.id INTO v_id
      FROM chart_of_accounts a
     WHERE a.is_active = true
       AND lower(btrim(a.account_name)) = lower(btrim(p_name))
     -- shared first, so both legs of a voucher land in the same space
     ORDER BY (a.company_id IS NOT NULL), a.account_code
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id FROM chart_of_accounts WHERE account_code = p_fallback_code;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.adamrit_ledger_by_name(TEXT, TEXT) IS
  'Resolves a ledger name to a chart_of_accounts row, preferring the shared '
  'copy so both legs of a voucher land in the same space. A company-owned row '
  'is used only where no shared row of that name exists.';

-- ------------------------------------------------------------------
-- Repair the entries already posted to a company-owned ledger where a shared
-- ledger of the same name exists. Only payment vouchers, only live ones, and
-- only the leg - no amount, voucher or date is touched.
-- ------------------------------------------------------------------
CREATE TEMP TABLE repointed AS
SELECT e.id AS entry_id, v.voucher_number, a.account_code AS was, s.account_code AS now_is,
       e.debit_amount, e.credit_amount
  FROM voucher_entries e
  JOIN vouchers v          ON v.id = e.voucher_id
                          AND v.status <> 'CANCELLED'
                          AND v.reference_number LIKE 'PV-%'
  JOIN chart_of_accounts a ON a.id = e.account_id AND a.company_id IS NOT NULL
  JOIN LATERAL (
    SELECT s2.id, s2.account_code
      FROM chart_of_accounts s2
     WHERE s2.is_active
       AND s2.company_id IS NULL
       AND lower(btrim(s2.account_name)) = lower(btrim(a.account_name))
     ORDER BY s2.account_code
     LIMIT 1
  ) s ON true;

UPDATE voucher_entries e
   SET account_id = (SELECT s.id FROM chart_of_accounts s
                      WHERE s.account_code = r.now_is)
  FROM repointed r
 WHERE e.id = r.entry_id;
