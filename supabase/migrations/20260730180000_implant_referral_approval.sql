-- Implant and referral commission becomes an approvable expense.
--
-- The RM's cut per visit is computed and edited in the Director's Daily
-- Revenue Report and lands in daily_revenue_entries.cut. Nothing then happens
-- to it: it is a number on a report, not a payable, so the commission the
-- hospital owes has never been in the books.
--
-- The Implant (Referral) dashboard in the Expense Bills tile turns those cuts
-- into a pending expense invoice per relationship manager. Approving one is
-- the existing approval_queue flow, so final approval posts the JV that flow
-- already posts:
--
--     Dr  5130 Referral & Implant Commission     the invoice amount
--         Cr  <the RM's mapped ledger>                same amount
--
-- Nothing here posts to the ledgers. Queueing is not approving.

-- ------------------------------------------------------------------
-- 1. The expense head. Company-neutral, because relationship managers
--    refer patients to both hospitals and the same head serves both.
-- ------------------------------------------------------------------
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5130', 'Referral & Implant Commission', 'INDIRECT_EXPENSES', 'Indirect Expenses', 0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

-- The RM ledgers this app created were filed under DRM Hope, but the cuts they
-- earn come from both hospitals. Company-neutral keeps one ledger per manager
-- instead of one per manager per company, and the ledger picker already treats
-- a null company as visible everywhere. Only the RM_ series is touched — the
-- Tally-imported ledgers keep their company.
UPDATE public.chart_of_accounts
   SET company_id = NULL
 WHERE account_code ~ '^RM_[0-9]+$'
   AND company_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. A referral commission is its own kind of payable, not a vendor bill.
-- ------------------------------------------------------------------
ALTER TABLE public.approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_category_check;

ALTER TABLE public.approval_queue
  ADD CONSTRAINT approval_queue_category_check
  CHECK (category IN ('VENDOR', 'DOCTOR', 'SALARY', 'REFERRAL'));

-- ------------------------------------------------------------------
-- 3. Which invoice a cut was billed on. Also what stops the same cut
--    being queued twice: the dashboard only lists rows where this is
--    null, and a rejected invoice releases its rows by clearing it.
-- ------------------------------------------------------------------
ALTER TABLE public.daily_revenue_entries
  ADD COLUMN IF NOT EXISTS approval_id UUID
    REFERENCES public.approval_queue(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.daily_revenue_entries.approval_id IS
  'The pending expense invoice this cut was billed on. Null means the cut is '
  'still waiting to be approved and will appear on the Implant (Referral) '
  'dashboard.';

CREATE INDEX IF NOT EXISTS idx_daily_revenue_entries_approval
  ON public.daily_revenue_entries(approval_id);

-- What the dashboard will show on its first open: cuts not yet billed, and
-- whether the manager who earned them has a ledger to credit.
SELECT CASE WHEN m.ledger_account_id IS NULL THEN 'manager not mapped' ELSE 'ready to approve' END AS state,
       count(*) AS cuts,
       sum(e.cut) AS amount
  FROM public.daily_revenue_entries e
  LEFT JOIN public.relationship_managers m
         ON lower(btrim(m.name)) = lower(btrim(e.rm_name))
        AND COALESCE(m.is_hidden, false) = false
 WHERE e.cut > 0
   AND COALESCE(e.is_hidden, false) = false
   AND e.approval_id IS NULL
   AND upper(btrim(COALESCE(e.rm_name, ''))) <> 'DIRECT'
 GROUP BY 1
 ORDER BY 1;
