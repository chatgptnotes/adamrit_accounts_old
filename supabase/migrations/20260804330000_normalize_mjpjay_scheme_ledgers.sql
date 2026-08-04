-- Normalize the MJPJAY scheme debtor ledgers.
--
-- DRM held the scheme twice: the Tally import "Mahatma Jotiba Janaarogya
-- Yojana (MJPJAY)" (DRMFRESH_000907, carrying the ₹46,14,519 Cr cutover
-- opening, 3 entries) and the app's canonical "Mahatma Jyotirao Phule Jan
-- Arogya Yojana (MJPJAY)" (code 1412, 35 entries, matching the corporate
-- master's name). The Tally twin folds into 1412 via the audited
-- merge_ledger. Ayushman's and the legacy partnership's copies are renamed
-- to the official spelling, mirrors included, so the Trial Balance keeps one
-- line per company.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- DRM: fold the Tally twin into the canonical 1412.
SELECT public.merge_ledger(
  'b69b259a-3297-4855-a784-c80908720842',   -- DRMFRESH_000907 (loser)
  '57f1c47b-4e75-4158-89d5-7723c40e4f95'    -- 1412 (survivor)
);

-- Ayushman + legacy partnership: rename to the official name.
UPDATE public.chart_of_accounts
   SET account_name = 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)'
 WHERE account_code IN ('TL5a9cc00hewvls', 'TLd718b10hewvls');

UPDATE public.tally_ledgers t
   SET name = 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)'
  FROM public.chart_of_accounts a
 WHERE t.accounting_account_id = a.id
   AND a.account_code IN ('TL5a9cc00hewvls', 'TLd718b10hewvls', '1412');

-- After: expect one ACTIVE ledger per company, all under the official name,
-- with DRM's carrying the merged Cr opening.
SELECT c.company_name, a.account_name, a.account_code, a.is_active,
       a.opening_balance, a.opening_balance_type
  FROM public.chart_of_accounts a
  LEFT JOIN public.companies c ON c.id = a.company_id
 WHERE a.account_name ILIKE '%jan%arogya%mjpjay%'
    OR a.account_name ILIKE '%janaarogya%'
 ORDER BY c.company_name, a.is_active DESC;

COMMIT;
