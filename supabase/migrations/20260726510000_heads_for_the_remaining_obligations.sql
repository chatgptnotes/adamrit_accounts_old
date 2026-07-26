-- Set a head for each obligation still falling back to 5000 EXPENSES.
--
-- Eight of them, about Rs 1,87,000 a day. Earlier I said eleven; that was
-- wrong - it is six under 'other' and two under 'vendor'.
--
-- Each is set by party name rather than category, because 'other' is not one
-- kind of thing. What each is charged to and why:
--
--   STAFF SALARY                 5210 Staff Salary
--       Plainly salary, filed under 'other' by mistake. Same head as the two
--       already there.
--
--   TDS Payment                  2130 TDS Payable            NOT an expense
--       Tax deducted from someone else's money and passed to the government.
--       It never belonged in the P&L. mark_obligation_paid debits whatever
--       head is set and credits cash, so pointing it at a liability gives
--       exactly the right entry: the liability falls, the cash goes out.
--       Rs 50,000 a day that would otherwise have overstated your costs.
--
--   NMC Property tax             5270 Rates & Taxes
--   Repairs, non medical         5260 Repairs & Maintenance
--   Repairs, medical equipment   5260 Repairs & Maintenance
--       Both repairs go to one head. Splitting medical from non-medical is a
--       reporting choice you may want, but it is a choice, not an obvious fact.
--
--   Vendors - Implants           5120 Medical Supplies
--   Vendors - Oxygen             5120 Medical Supplies
--       Where the implant bill trigger already posts, so the two paths agree.
--       Note this is the head you said commission is booked under.
--
-- LEFT ALONE ON PURPOSE. 'Spot and Backing', Rs 30,000 a day. I do not know
-- what it is, and a guess here would be filed as fact and repeat every day.
-- It keeps landing in 5000 EXPENSES until you say. That is the honest place
-- for something unclassified.
--
-- An existing ledger of the right name is preferred over a new one, so this
-- does not create a second TDS or Repairs account beside one already there.

INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5260', 'Repairs & Maintenance', 'INDIRECT_EXPENSES',    'Indirect Expenses', 0, 'DR', true),
  ('5270', 'Rates & Taxes',         'INDIRECT_EXPENSES',    'Indirect Expenses', 0, 'DR', true),
  ('2130', 'TDS Payable',           'CURRENT_LIABILITIES',  'Duties & Taxes',    0, 'CR', true)
ON CONFLICT (account_code) DO NOTHING;

UPDATE public.payment_obligations o
   SET chart_of_accounts_id = pick.id,
       updated_at = now()
  FROM (VALUES
         ('staff salary',                         '5210', '%staff salary%'),
         ('tds payment',                          '2130', '%tds%'),
         ('nmc property tax',                     '5270', '%rates%tax%'),
         ('repairs & maintenance - non medical',  '5260', '%repairs%'),
         ('repairs & maintenance - medical equipment', '5260', '%repairs%'),
         ('vendors - implants',                   '5120', '%medical suppl%'),
         ('vendors - oxygen',                     '5120', '%medical suppl%')
       ) AS v(party, code, existing_pattern)
  JOIN LATERAL (
    -- an existing ledger of that name first, then the one seeded above
    SELECT a.id
      FROM public.chart_of_accounts a
     WHERE a.is_active
       AND (a.account_code = v.code
         OR lower(a.account_name) LIKE v.existing_pattern)
     ORDER BY (a.account_code = v.code) DESC,
              (a.company_id IS NOT NULL),
              length(a.account_name)
     LIMIT 1
  ) pick ON true
 WHERE o.chart_of_accounts_id IS NULL
   AND lower(btrim(o.party_name)) = v.party;
