-- Fix the heads that landed on the wrong account, and finish the mapping.
--
-- WHAT WENT WRONG. I seeded 2130, 5260 and 5270 with ON CONFLICT DO NOTHING,
-- then looked the head up by code. All three codes were already taken:
--
--   2130 is Bank Overdraft, not TDS Payable   -> TDS was debiting an overdraft
--   5270 is Insurance, not Rates & Taxes      -> property tax was debiting insurance
--   5260 is Maintenance                       -> close enough, left as it is
--
-- Third time today a code I assumed was free was not. So this stops using
-- numeric codes for new heads entirely and creates them under names, with
-- codes that cannot collide - the chart already holds SUSPENSE-HOPE and
-- PT<id>, so a text code is normal here.
--
-- An existing ledger of the right kind still wins. A real TDS liability or
-- rates account, if one is already in the chart, is used in preference to
-- anything created here.
--
-- ALSO FINISHES THE JOB. 20260726500000 mapped by category and was never run,
-- so rent, dialysis, electricity, consultant and the salary lines are still
-- unclassified. That mapping is repeated here. This migration supersedes
-- 20260726470000, 20260726480000, 20260726500000 and 20260726510000; none of
-- them needs running.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
SELECT v.code, v.name, v.acct_type, v.grp, 0, v.dr_cr, true
  FROM (VALUES
         ('TDS-PAYABLE',  'TDS Payable',           'CURRENT_LIABILITIES', 'Duties & Taxes',    'CR'),
         ('RATES-TAXES',  'Rates & Taxes',         'INDIRECT_EXPENSES',   'Indirect Expenses', 'DR'),
         ('OBL-RENT',     'Rent',                  'INDIRECT_EXPENSES',   'Indirect Expenses', 'DR'),
         ('OBL-POWER',    'Electricity',           'INDIRECT_EXPENSES',   'Indirect Expenses', 'DR'),
         ('OBL-DIALYSIS', 'Dialysis Charges',      'INDIRECT_EXPENSES',   'Indirect Expenses', 'DR'),
         ('OBL-CONSULT',  'Consultancy Fees',      'INDIRECT_EXPENSES',   'Indirect Expenses', 'DR')
       ) AS v(code, name, acct_type, grp, dr_cr)
 WHERE NOT EXISTS (
   -- only create what the chart does not already have under that name
   SELECT 1 FROM public.chart_of_accounts a
    WHERE a.is_active AND lower(btrim(a.account_name)) = lower(v.name)
 )
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------
-- Point every obligation at a head chosen BY NAME. Shared ledgers are
-- preferred over company-owned ones, so both legs of a payment stay in the
-- same company.
-- ------------------------------------------------------------------
UPDATE public.payment_obligations o
   SET chart_of_accounts_id = pick.id,
       updated_at = now()
  FROM (VALUES
         -- by party, where the category is wrong or too coarse
         ('party', 'tds payment',                                '%tds%',            'LIAB'),
         ('party', 'nmc property tax',                           '%rates%tax%',      'EXP'),
         ('party', 'staff salary',                               '%staff salary%',   'EXP'),
         ('party', 'repairs & maintenance - non medical',         '%maintenance%',    'EXP'),
         ('party', 'repairs & maintenance - medical equipment',   '%maintenance%',    'EXP'),
         ('party', 'vendors - implants',                          '%medical suppl%',  'EXP'),
         ('party', 'vendors - oxygen',                            '%medical suppl%',  'EXP'),
         -- by category, for the recurring heads
         ('cat',   'salary',                                      '%staff salary%',   'EXP'),
         ('cat',   'rmo',                                         '%staff salary%',   'EXP'),
         ('cat',   'rent',                                        '%rent%',           'EXP'),
         ('cat',   'electricity',                                 '%electricity%',    'EXP'),
         ('cat',   'dialysis',                                    '%dialysis%',       'EXP'),
         ('cat',   'consultant',                                  '%consultancy%',    'EXP')
       ) AS v(kind, key, name_pattern, side)
  JOIN LATERAL (
    SELECT a.id
      FROM public.chart_of_accounts a
     WHERE a.is_active
       AND lower(a.account_name) LIKE v.name_pattern
       AND ((v.side = 'LIAB' AND a.account_type LIKE '%LIABILIT%')
         OR (v.side = 'EXP'  AND a.account_type IN ('INDIRECT_EXPENSES','DIRECT_EXPENSES')))
     ORDER BY (a.company_id IS NOT NULL), length(a.account_name), a.account_code
     LIMIT 1
  ) pick ON true
 WHERE (v.kind = 'party' AND lower(btrim(o.party_name)) = v.key)
    OR (v.kind = 'cat'   AND o.chart_of_accounts_id IS NULL
                         AND lower(btrim(COALESCE(o.sub_category, ''))) = v.key);
