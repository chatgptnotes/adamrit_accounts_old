-- Give each payment obligation the expense head it should be charged to.
--
-- WHY NOT payment_obligation_ledgers. That table already exists and looks like
-- the answer, but it is not: ledger_id references tally_ledgers and company_id
-- references tally_config, and its own comment says it exists so the director
-- can see live outstanding across Tally companies. It is a Tally-side lookup,
-- and every tally_config row was deactivated on 2026-07-26. Mapping into it
-- would populate a view and post nothing.
--
-- What is missing is a link from an obligation to Adamrit's own chart of
-- accounts. This adds it, in the same shape as suppliers.ledger_account_id and
-- corporate.ledger_account_id.
--
-- MAPPED BY CATEGORY, NOT BY PARTY. The party is who you pay; the expense head
-- is what it was for. Ten of the obligations are named after people - salary is
-- charged to a salary head, not to a ledger named KAUSTUB HADAKE. So the
-- sub_category decides, and only where exactly one active expense ledger
-- carries a matching name. Where two could match, nothing is set: guessing
-- between two heads is worse than leaving it visible.
--
-- vendor and other are deliberately not mapped. A vendor payment is a purchase
-- from a specific party and belongs on that party's own head, which has to be
-- chosen per obligation rather than inferred from a word.
--
-- THIS MAPPING ALONE DOES NOT POST ANYTHING. mark_obligation_paid was created
-- outside the migrations and its body has not been read, so what it debits is
-- still unknown. This puts the answer where a posting can find it; wiring it in
-- is the next step and needs that function first.

ALTER TABLE public.payment_obligations
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES public.chart_of_accounts(id);

COMMENT ON COLUMN public.payment_obligations.ledger_account_id IS
  'Adamrit expense head this obligation is charged to. Distinct from '
  'payment_obligation_ledgers, which points at Tally ledgers for the director view.';

CREATE INDEX IF NOT EXISTS idx_payment_obligations_ledger
  ON public.payment_obligations(ledger_account_id);

-- Category to expense head, matched on the name and only where one candidate
-- exists. Patterns are deliberately narrow.
UPDATE public.payment_obligations o
   SET ledger_account_id = m.id,
       updated_at = now()
  FROM (
    SELECT v.sub_category,
           (array_agg(a.id ORDER BY length(a.account_name), a.account_code))[1] AS id
      FROM (VALUES
             ('salary',      '%salary%'),
             ('rmo',         '%salary%'),
             ('rent',        '%rent%'),
             ('electricity', '%electric%'),
             ('dialysis',    '%dialysis%'),
             ('consultant',  '%consultan%')
           ) AS v(sub_category, pattern)
      JOIN public.chart_of_accounts a
        ON a.is_active
       AND a.account_type IN ('INDIRECT_EXPENSES', 'DIRECT_EXPENSES')
       AND lower(a.account_name) LIKE v.pattern
     GROUP BY v.sub_category
    HAVING count(*) = 1
  ) m
 WHERE o.ledger_account_id IS NULL
   AND lower(btrim(COALESCE(o.sub_category, ''))) = m.sub_category;
