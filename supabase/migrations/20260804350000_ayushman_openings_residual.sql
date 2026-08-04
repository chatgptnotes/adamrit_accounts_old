-- Ayushman openings: the ₹24,500 residual.
--
-- Three doctors exist in the Tally file under two spellings each (the pairs
-- merged in Adamrit earlier today). The cutover script wrote one spelling's
-- value instead of the pair's SUM. Corrected here; Ayushman's openings then
-- net to exactly zero like DRM and Pharmacy.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.
BEGIN;
UPDATE public.chart_of_accounts SET opening_balance=2000.00, opening_balance_type='DR' WHERE id='28e7e061-ac24-4211-8df3-a62aea223ab7';  -- Dr. Rasika Akulwar (sum of Tally spellings)
UPDATE public.chart_of_accounts SET opening_balance=28000.00, opening_balance_type='DR' WHERE id='ae9f5845-9e90-459d-ab13-02c56a32ef45';  -- Dr. Rupesh Bhange (sum of Tally spellings)
UPDATE public.chart_of_accounts SET opening_balance=10000.00, opening_balance_type='DR' WHERE id='8daa84f7-3121-48c5-a802-3c390f617519';  -- Shri Vitthal Ads (sum of Tally spellings)
SELECT c.company_name,
       round(sum(CASE WHEN UPPER(COALESCE(a.opening_balance_type,'DR'))='CR'
                      THEN -COALESCE(a.opening_balance,0)
                      ELSE COALESCE(a.opening_balance,0) END)::numeric, 2) AS net_should_be_zero
  FROM public.chart_of_accounts a
  JOIN public.companies c ON c.id = a.company_id
 WHERE a.is_active
 GROUP BY c.company_name ORDER BY c.company_name;

COMMIT;
