-- Point of Contact on the ledger master.
--
-- The person we actually deal with at a vendor / company — the owner or the
-- contact — recorded once on the ledger (optional field on the Ledger
-- Creation / Alteration form), instead of being retyped bill by bill.
--
-- The Expense Bill register's search already covers point_of_contact; the
-- view now falls back to the party LEDGER's contact when the bill itself has
-- none, so searching an invoice by the contact person recorded on the ledger
-- just works.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS point_of_contact TEXT;

COMMENT ON COLUMN public.chart_of_accounts.point_of_contact IS
  'The owner or person we deal with at this party (optional). Shown and searched on the Expense Bill page for every bill of this ledger.';

-- Same view as 20260804150000, with point_of_contact now falling back to the
-- party ledger's contact person.
DROP VIEW IF EXISTS public.v_expense_bills_outstanding;
CREATE VIEW public.v_expense_bills_outstanding AS
SELECT b.id,
       b.bill_number,
       b.bill_date,
       b.due_date,
       p.account_name                                   AS party,
       x.account_name                                   AS expense_head,
       b.amount                                         AS billed,
       COALESCE(paid.amount, 0)                         AS paid,
       b.amount - COALESCE(paid.amount, 0)              AS outstanding,
       b.document_url,
       b.status,
       b.company_id,
       b.narration,
       COALESCE(NULLIF(btrim(b.point_of_contact), ''), p.point_of_contact)
                                                        AS point_of_contact,
       b.relationship_manager,
       b.patient_name,
       b.patient_type,
       b.revenue_entry_id,
       b.created_at
  FROM public.expense_bills b
  JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
  JOIN public.chart_of_accounts x ON x.id = b.expense_ledger_id
  LEFT JOIN LATERAL (
    SELECT sum(e.debit_amount) AS amount
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id
     WHERE e.account_id = b.party_ledger_id
       AND btrim(COALESCE(e.bill_ref, '')) = btrim(b.bill_number)
       AND v.company_id IS NOT DISTINCT FROM b.company_id
       AND v.status = 'AUTHORISED'
       AND e.debit_amount > 0
  ) paid ON true
 WHERE b.status = 'POSTED';

ALTER VIEW public.v_expense_bills_outstanding SET (security_invoker = true);
GRANT SELECT ON public.v_expense_bills_outstanding TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
