-- Masters needed before a bill can be accrued into the ledger.
--
-- The income ledgers below are nominally seeded by 20250613000000, but that
-- seed is one multi-row INSERT with no ON CONFLICT and it collides on
-- account_code with the earlier seed in 20250612230000 — so on any database
-- where the earlier one ran, the whole statement aborted and 4110-4150 do not
-- exist. Same story for voucher_types. Everything here is written to be safe
-- either way.
--
-- account_group carries the Tally sub-group and is what mergedLedgerBalances
-- now reads for the group column, so the strings must match the names in
-- src/components/accounting/tally/heads.ts.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group, opening_balance, opening_balance_type, is_active)
VALUES
  ('4110', 'Consultation Fees',      'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('4120', 'Procedure Charges',      'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('4130', 'Surgery Charges',        'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('4140', 'Investigation Charges',  'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('4150', 'Medicine Sales',         'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('4170', 'Accommodation Charges',  'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('4180', 'Implants & Consumables', 'DIRECT_INCOME',      'Direct Incomes',     0, 'CR', true),
  ('5300', 'Discount Allowed',       'INDIRECT_EXPENSES',  'Indirect Expenses',  0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO public.voucher_types
  (voucher_type_code, voucher_type_name, voucher_category, prefix, current_number, is_active)
VALUES
  ('SV', 'Sales Voucher',   'SALES',   'SV', 0, true),
  ('JV', 'Journal Voucher', 'JOURNAL', 'JV', 0, true)
ON CONFLICT (voucher_type_code) DO NOTHING;

-- Which ledger carries a scheme/corporate patient's receivable. Hung off the
-- existing corporate master rather than a new mapping table, because
-- visits.corporate / patients.corporate already store that name.
ALTER TABLE public.corporate
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES public.chart_of_accounts(id);

-- Seed by exact (case-insensitive) name match against the Sundry Debtors
-- ledgers the DRM master import created. Anything that does not match stays
-- NULL and simply gets no payer-split voucher until someone maps it by hand.
UPDATE public.corporate c
   SET ledger_account_id = a.id
  FROM public.chart_of_accounts a
 WHERE c.ledger_account_id IS NULL
   AND a.is_active = true
   AND lower(btrim(a.account_group)) = 'sundry debtors'
   AND lower(btrim(a.account_name)) = lower(btrim(c.name));
