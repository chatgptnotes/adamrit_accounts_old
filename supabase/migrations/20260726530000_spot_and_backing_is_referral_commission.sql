-- Spot and Backing is referral commission, so file it where commission goes.
--
-- It was the one obligation left unclassified, at Rs 30,000 a day, because the
-- name told me nothing. It is the commission paid for referring a patient:
-- spot on admission, backing on discharge.
--
-- You said commission is recorded in the books as implant purchases, which is
-- where Vendors - Implants already posts, so this goes to the same head. The
-- point is consistency: the same payment should not land in two places
-- depending on which screen recorded it.
--
-- ONE FOR YOUR ACCOUNTANT, AND ONLY ONE. Commission and purchases are not the
-- same thing for tax - commission ordinarily attracts TDS where a purchase does
-- not. This migration records what you told me is your practice; it does not
-- endorse the head. Changing it later is a single UPDATE, but every day it runs
-- adds entries under whichever head is set, so it is worth settling early.

UPDATE public.payment_obligations o
   SET chart_of_accounts_id = pick.id,
       updated_at = now()
  FROM LATERAL (
    SELECT a.id
      FROM public.chart_of_accounts a
     WHERE a.is_active
       AND lower(a.account_name) LIKE '%medical suppl%'
       AND a.account_type IN ('INDIRECT_EXPENSES', 'DIRECT_EXPENSES')
     ORDER BY (a.company_id IS NOT NULL), length(a.account_name), a.account_code
     LIMIT 1
  ) pick
 WHERE lower(btrim(o.party_name)) = 'spot and backing';
