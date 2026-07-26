-- Create the Canara Bank (Jaripatka) ledger that never existed.
--
-- 20251031000004_add_canara_bank.sql inserted account 1123 with
-- account_type = 'BANK'. That value is not in the chart_of_accounts CHECK
-- constraint (20250612230000:9-14), which permits ASSETS, CURRENT_ASSETS,
-- LIABILITIES and so on but not BANK - that belongs in account_group. The
-- statement therefore failed the check and the row was never created;
-- ON CONFLICT DO NOTHING does not swallow a check violation.
--
-- It matters because AdvancePaymentModal.tsx:229 builds its bank dropdown from
-- account_code IN ('1121','1122','1123'), so Canara Bank has simply been
-- missing from the list and no advance payment could be routed to it.
--
-- Shaped to match 1124 (the Hope Pharmacy Canara account), which was written
-- correctly: CURRENT_ASSETS as the type, BANK as the group. The name is
-- normalised to the same pattern - the original carried a mismatched bracket
-- and a trailing space, 'Canara Bank [A/C120023677813)JARIPATHKA ]'.

INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group,
  opening_balance, opening_balance_type, is_active, parent_account_id
) VALUES (
  '1123',
  'Canara Bank [A/C120023677813] JARIPATKA',
  'CURRENT_ASSETS',
  'BANK',
  0.00, 'DR', true,
  (SELECT id FROM public.chart_of_accounts WHERE account_code = '1100' LIMIT 1)
)
ON CONFLICT (account_code) DO UPDATE
  SET account_type  = 'CURRENT_ASSETS',
      account_group = 'BANK',
      is_active     = true,
      updated_at    = now();
