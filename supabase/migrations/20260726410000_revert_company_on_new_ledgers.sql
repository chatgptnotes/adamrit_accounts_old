-- Put 4190, 5900, 1470 and 2120 back to no company. The previous migration was
-- wrong and made every company's balance worse.
--
-- WHAT I GOT WRONG. I read a company-less ledger as a leak, because the reports
-- count it into every company. But that is the design, not a defect: this chart
-- of accounts is not four separate sets of books. 1110 Cash in Hand, 4160
-- Hospital Services Income and the rest are shared, and the reports work
-- precisely because a shared ledger appears in every company that uses it.
--
-- When BOTH legs of a voucher sit on shared ledgers, every company sees both
-- and balances. The imbalance only appears when ONE leg is company-scoped and
-- the other is not - which is what I created by assigning companies to some
-- ledgers while their opposite legs stayed shared. Before: one artificial
-- bucket out by 2,750. After: all four companies out, by 12,515, -5,835,
-- -3,085 and -12,850.
--
-- 5900 Petty Cash Expenses shows it plainly. The rule assigned it to Ayushman
-- Nagpur, correctly, because those vouchers carry hospital_type 'ayushman'. But
-- the cash they credit is 1110, which belongs elsewhere. So Ayushman gained a
-- debit with no matching credit and another company gained the reverse.
--
-- THE REAL QUESTION IS NOT A BUG. Whether the four companies should have
-- genuinely separate ledgers - their own cash, their own income - or keep
-- sharing them, is a decision about how the books are kept. Separating them
-- means a row per company for every shared ledger and every posting function
-- choosing by company. That is a real piece of work and it should be chosen
-- deliberately, not arrived at through a migration that was meant to tidy four
-- account codes.
--
-- Until then, shared is what the reports expect, so shared is what these are.

UPDATE public.chart_of_accounts
   SET company_id = NULL,
       updated_at = now()
 WHERE account_code IN ('4190', '5900', '1470', '2120');
