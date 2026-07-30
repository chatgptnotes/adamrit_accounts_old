-- Link PMJAY / Ayushman Bharat (and MJPJAY) to their scheme debtor ledgers.
--
-- WHY THIS EXISTS
-- The obligation transfer in post_bill_vouchers (V3) and the Yojna bill posting
-- in post_one_yojna_bill both read corporate.ledger_account_id to decide which
-- ledger carries the scheme receivable. When it is NULL the claim silently stays
-- on the patient - the income is booked but the receivable sits on the wrong
-- party, the scheme debtor looks understated, and the later remittance settles
-- nothing because it credits a ledger that was never debited.
--
-- A standalone create_panel_ledgers.sql at the repo root already creates ledger
-- 1411 (PMJAY) and 1412 (MJPJAY) and maps them, but it is not part of the
-- migration sequence and so is not guaranteed to have run in every environment.
-- This makes the link from inside the migration chain so it cannot be missed.
--
-- SAFE FILL ONLY
-- Only empty links are filled. A corporate row that someone has already pointed
-- at a different ledger is left untouched - overriding a conscious choice would
-- risk putting a claim on the wrong debtor, which is worse than leaving it
-- visible. This is the same convention used by map_yojna_schemes.sql and the
-- obligation-expense mapping.
--
-- Both ledgers are CURRENT_ASSETS under the 'Sundry Debtors' group (the exact
-- string heads.ts maps to the Current Assets primary group) and belong to DRM
-- Hope Pvt Ltd - the operating company that treats scheme patients. Ayushman
-- Nagpur is a separate private-only hospital and is unaffected.

-- ------------------------------------------------------------------
-- 1. Ensure the scheme debtor ledgers exist in the chart of accounts.
-- ------------------------------------------------------------------
INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group,
  opening_balance, opening_balance_type, is_active, company_id
)
SELECT v.account_code, v.account_name, 'CURRENT_ASSETS', 'Sundry Debtors',
       0, 'DR', true,
       (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd')
  FROM (VALUES
    ('1411', 'Pradhan Mantri Jan Arogya Yojana (PMJAY)'),
    ('1412', 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)')
  ) AS v(account_code, account_name)
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------
-- 2. Fill the empty corporate.ledger_account_id link for PMJAY/Ayushman.
--    Matched case-insensitively on the scheme name; every variant seen in the
--    master ('Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)', etc.)
--    contains one of these tokens.
-- ------------------------------------------------------------------
UPDATE public.corporate c
   SET ledger_account_id = (
         SELECT id FROM public.chart_of_accounts WHERE account_code = '1411'
       ),
       updated_at = now()
 WHERE c.ledger_account_id IS NULL
   AND ( lower(c.name) LIKE '%pmjay%'
          OR lower(c.name) LIKE '%pm-jay%'
          OR lower(c.name) LIKE '%pm jay%'
          OR lower(c.name) LIKE '%ayushman%'
          OR lower(c.name) LIKE '%pradhan mantri jan arogya%' );

-- ------------------------------------------------------------------
-- 3. Fill the empty link for MJPJAY (Maharashtra's sibling scheme).
-- ------------------------------------------------------------------
UPDATE public.corporate c
   SET ledger_account_id = (
         SELECT id FROM public.chart_of_accounts WHERE account_code = '1412'
       ),
       updated_at = now()
 WHERE c.ledger_account_id IS NULL
   AND ( lower(c.name) LIKE '%mjpjay%'
          OR lower(c.name) LIKE '%jyotirao phule%'
          OR lower(c.name) LIKE '%phule jan arogya%' );

-- ------------------------------------------------------------------
-- 4. Report: which scheme-named panels are now linked, and which are not.
--    A row that names PMJAY/MJPJAY but still shows NULL is a master-data gap
--    that must be resolved by hand - its ledger does not exist yet or it was
--    deliberately left unmapped.
-- ------------------------------------------------------------------
SELECT c.name AS panel,
       a.account_code || ' ' || a.account_name AS linked_ledger,
       CASE WHEN c.ledger_account_id IS NULL THEN 'STILL UNMAPPED - the patient would carry the claim'
            ELSE 'linked' END AS state
  FROM public.corporate c
  LEFT JOIN public.chart_of_accounts a ON a.id = c.ledger_account_id
 WHERE lower(c.name) LIKE '%pmjay%'
    OR lower(c.name) LIKE '%pm-jay%'
    OR lower(c.name) LIKE '%pm jay%'
    OR lower(c.name) LIKE '%ayushman%'
    OR lower(c.name) LIKE '%pradhan mantri jan arogya%'
    OR lower(c.name) LIKE '%mjpjay%'
    OR lower(c.name) LIKE '%jyotirao phule%'
    OR lower(c.name) LIKE '%phule jan arogya%'
 ORDER BY c.ledger_account_id IS NULL DESC, c.name;