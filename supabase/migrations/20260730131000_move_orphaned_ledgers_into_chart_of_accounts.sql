-- The ledgers created on the Masters screen before it wrote chart_of_accounts.
--
-- Of the 11 rows in `ledgers`, most already exist in DRM Hope's chart of
-- accounts under the same name from the Tally masters import, so this moves
-- only the ones with no counterpart — matched on the name, because a blind
-- backfill would duplicate the rest and a duplicate name collapses into one
-- line on the Trial Balance.
--
-- Run AFTER 20260730130000_ledger_masters_on_chart_of_accounts.sql, which adds
-- the alias / mailing / bank / tax columns this copies into.
--
-- Opening balances are deliberately NOT carried over. The accounting module
-- went live on 2026-07-25 with Tally's opening balances; the one legacy figure
-- here (Pooja, 889 Dr, entered 2025-07-14) predates that cutover, and if it is
-- still owed it belongs in a dated voucher, not in an opening balance.
--
-- Re-running is a no-op: the same NOT EXISTS guard skips anything already moved.

WITH hope AS (
  SELECT id
    FROM public.companies
   WHERE lower(company_name) LIKE '%drm%'
     AND lower(company_name) LIKE '%hope%'
   ORDER BY is_active DESC
   LIMIT 1
),
orphans AS (
  SELECT l.*
    FROM public.ledgers l
   CROSS JOIN hope
   WHERE COALESCE(l.is_active, true)
     AND NOT EXISTS (
       SELECT 1
         FROM public.chart_of_accounts c
        WHERE c.company_id = hope.id
          AND lower(btrim(c.account_name)) = lower(btrim(l.name))
     )
)
INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group, company_id,
  parent_account_id, is_active, opening_balance, opening_balance_type,
  ledger_group_id, alias, mailing_name, address, state, country, pincode,
  bank_name, bank_branch, bank_account_number, ifsc_code, pan, gstin
)
SELECT
  -- 14 chars, inside account_code's VARCHAR(20). The Tally masters importer
  -- matches on the name and reuses whatever code a row already has, so this
  -- does not have to be the importer's own TL… hash to stay idempotent.
  'LG' || left(replace(o.id::text, '-', ''), 12),
  btrim(o.name),
  -- The same rules as src/lib/ledgerMasters.ts matchAccountType: the bracketed
  -- "(Asset)" marker first, `indirect` tested before `direct`, and this data's
  -- misspelling "Expence" matched — a miss would fall through to Current Assets
  -- and file an expense ledger on the balance sheet.
  CASE
    WHEN lower(o.group_name) LIKE '%(asset)%'                                      THEN 'CURRENT_ASSETS'
    WHEN lower(o.group_name) LIKE '%bank%' OR lower(o.group_name) LIKE '%cash%'
      OR lower(o.group_name) LIKE '%debtor%' OR lower(o.group_name) LIKE '%stock%'  THEN 'CURRENT_ASSETS'
    WHEN lower(o.group_name) LIKE '%fixed asset%'                                   THEN 'FIXED_ASSETS'
    WHEN lower(o.group_name) LIKE '%loan%'                                          THEN 'LONG_TERM_LIABILITIES'
    WHEN lower(o.group_name) LIKE '%creditor%' OR lower(o.group_name) LIKE '%dutie%'
      OR lower(o.group_name) LIKE '%liabilit%'                                      THEN 'CURRENT_LIABILITIES'
    WHEN lower(o.group_name) LIKE '%capital%' OR lower(o.group_name) LIKE '%reserve%' THEN 'EQUITY'
    WHEN lower(o.group_name) LIKE '%indirect inc%' OR lower(o.group_name) LIKE '%income%'
      OR lower(o.group_name) LIKE '%sale%'                                          THEN
        CASE WHEN lower(o.group_name) LIKE '%indirect%' THEN 'INDIRECT_INCOME'
             WHEN lower(o.group_name) LIKE '%direct%'   THEN 'DIRECT_INCOME'
             ELSE 'INDIRECT_INCOME' END
    WHEN lower(o.group_name) LIKE '%expense%' OR lower(o.group_name) LIKE '%expence%'
      OR lower(o.group_name) LIKE '%expance%' OR lower(o.group_name) LIKE '%purchase%' THEN
        CASE WHEN lower(o.group_name) LIKE '%indirect%' THEN 'INDIRECT_EXPENSES'
             WHEN lower(o.group_name) LIKE '%direct%'   THEN 'DIRECT_EXPENSES'
             ELSE 'INDIRECT_EXPENSES' END
    -- "Consultant" and "Rmo Salary" are Sundry Creditors sub-groups in this
    -- company's Tally tree, and that is where the imported siblings sit.
    WHEN lower(o.group_name) LIKE '%consultant%' OR lower(o.group_name) LIKE '%salary%' THEN 'CURRENT_LIABILITIES'
    ELSE 'CURRENT_ASSETS'
  END,
  btrim(o.group_name),
  hope.id,
  NULL,
  true,
  0,
  NULL,
  o.group_id,
  o.alias,
  o.mailing_name,
  o.address,
  o.state,
  o.country,
  o.pincode,
  o.bank_name,
  o.bank_branch,
  o.account_number,
  o.ifsc_code,
  o.pan,
  o.gstin
FROM orphans o
CROSS JOIN hope
ON CONFLICT (account_code) DO NOTHING;
