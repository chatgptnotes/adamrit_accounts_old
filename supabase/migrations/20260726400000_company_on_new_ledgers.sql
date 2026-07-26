-- Give the ledgers created this week the company that actually uses them.
--
-- I created 4190, 5900, 1470 and 2120 without a company_id. mergedLedgerBalances
-- counts a company-less ledger into EVERY company, which is why that felt
-- harmless - but it is not. When one leg of a voucher sits on a company-less
-- ledger and the other on a company's own, the company that made the entry sees
-- both legs and balances, while the other three see only the company-less leg.
-- The movement leaks into books that never made it, and each of those books is
-- out by that amount.
--
-- The company is not chosen by me. It is read from the vouchers that have
-- actually posted to each ledger: if every one of them belongs to a single
-- company, that is whose ledger it is.
--
-- WHERE TWO COMPANIES HAVE POSTED, NOTHING IS CHANGED. 2120 Other Creditors is
-- the likely case - the pharmacy GRN accrual credits it for Hope Pharmacy, and
-- an implant bill from an unmapped vendor credits it for DRM Hope. Assigning it
-- to one would take the other's creditors out of that company's books, which is
-- worse than the leak. A ledger genuinely used by two companies needs one row
-- per company, and that is a decision about how the four sets of books are
-- separated - not something to infer inside a migration.
--
-- Ledgers with no postings yet are assigned too, from the company their trigger
-- posts under, so the first entry does not create the same leak.

CREATE TEMP TABLE ledger_company_before AS
SELECT id, account_code, account_name, company_id FROM public.chart_of_accounts;

-- Assign from the evidence: one company has posted, so it is theirs.
UPDATE public.chart_of_accounts a
   SET company_id = u.only_company,
       updated_at = now()
  FROM (
    SELECT e.account_id,
           (array_agg(DISTINCT v.company_id))[1] AS only_company
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id
                            AND v.status <> 'CANCELLED'
                            AND v.company_id IS NOT NULL
     GROUP BY e.account_id
    HAVING count(DISTINCT v.company_id) = 1
  ) u
 WHERE a.id = u.account_id
   AND a.company_id IS NULL
   AND a.account_code IN ('4190', '5900', '1470', '2120');

-- The ones nothing has posted to yet: take the company their trigger will use.
-- Pharmacy money belongs to Hope Pharmacy, per how the group is organised.
UPDATE public.chart_of_accounts a
   SET company_id = c.id,
       updated_at = now()
  FROM public.companies c
 WHERE c.company_key = 'hope_pharmacy'
   AND a.company_id IS NULL
   AND a.account_code IN ('4190', '1470');

-- Petty cash posts under whichever hospital wrote the voucher, but the ledger
-- can only belong to one. DRM Hope is where payment_vouchers default
-- (hospital_type defaults to 'hope'), so that is the honest owner.
UPDATE public.chart_of_accounts a
   SET company_id = c.id,
       updated_at = now()
  FROM public.companies c
 WHERE c.company_key = 'drm_pvt_ltd'
   AND a.company_id IS NULL
   AND a.account_code = '5900';
