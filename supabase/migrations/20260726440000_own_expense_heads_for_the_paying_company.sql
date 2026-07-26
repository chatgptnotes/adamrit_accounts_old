-- Give a company its own copy of an expense head it actually spent on.
--
-- Three companies balance. Ayushman is out by 4,700 across five petty cash
-- entries sitting on DRM Hope expense heads - DRMFRESH_001612, _000941 and
-- _001116. The previous repair could not move them: Ayushman has no ledger of
-- those names and neither does the shared set, so there was nothing to move to.
--
-- Ayushman really did spend that money, so it really does need those heads.
-- Creating them is the honest answer; leaving the entries on DRM Hope's ledgers
-- would put Ayushman's spending in DRM Hope's expenses and leave Ayushman's own
-- books short by the same amount.
--
-- NO FIGURE CHANGES. Each new ledger copies the name, type and group of the
-- one it mirrors and opens at zero. Only the attribution of existing entries
-- moves, and only within one company's own spending. The whole book stays at
-- 0.00 throughout - it was never the total that was wrong, only whose it was.
--
-- Written generally rather than for the five, so it finishes the job whatever
-- the count turns out to be.

CREATE TEMP TABLE heads_to_create AS
SELECT DISTINCT
       a.id                AS source_id,
       a.account_name,
       a.account_type,
       a.account_group,
       v.company_id        AS for_company,
       -- 15-char source codes plus a 3-letter company tag stays inside the
       -- 20-char limit on account_code.
       left(a.account_code, 16) || '-'
         || upper(left(regexp_replace(c.company_key, '[^a-z]', '', 'g'), 3)) AS new_code
  FROM voucher_entries e
  JOIN vouchers v          ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
  JOIN chart_of_accounts a ON a.id = e.account_id
                          AND a.company_id IS NOT NULL
                          AND a.company_id IS DISTINCT FROM v.company_id
  JOIN companies c         ON c.id = v.company_id
 WHERE NOT EXISTS (
   SELECT 1 FROM chart_of_accounts x
    WHERE x.is_active
      AND lower(btrim(x.account_name)) = lower(btrim(a.account_name))
      AND (x.company_id = v.company_id OR x.company_id IS NULL)
 );

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active, company_id)
SELECT h.new_code, h.account_name, h.account_type, h.account_group,
       0, 'DR', true, h.for_company
  FROM heads_to_create h
ON CONFLICT (account_code) DO NOTHING;

-- Move the entries onto the paying company's own head.
CREATE TEMP TABLE moved_to_own_head AS
SELECT e.id AS entry_id, v.voucher_number, a.account_code AS was,
       n.account_code AS now_is, a.account_name,
       e.debit_amount, e.credit_amount, n.id AS target
  FROM voucher_entries e
  JOIN vouchers v          ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
  JOIN chart_of_accounts a ON a.id = e.account_id
                          AND a.company_id IS NOT NULL
                          AND a.company_id IS DISTINCT FROM v.company_id
  JOIN chart_of_accounts n ON n.is_active
                          AND n.company_id = v.company_id
                          AND lower(btrim(n.account_name)) = lower(btrim(a.account_name));

UPDATE voucher_entries e
   SET account_id = m.target
  FROM moved_to_own_head m
 WHERE e.id = m.entry_id;
