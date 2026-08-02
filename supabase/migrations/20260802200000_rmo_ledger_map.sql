-- Map every RMO to their ledger in the accounting module.
--
-- The RMO duty roster on the OT tile queued payables by NAME, leaving the
-- ledger to be picked later in the Approvals queue. Recording the ledger on
-- the RMO master itself means the duty entry carries its party ledger from
-- the start, the roster can restrict its search to RMOs whose ledgers exist,
-- and the beneficiary bank (already on the ledger) shows up wherever the
-- RMO is picked.

ALTER TABLE public.hope_rmos
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID
    REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.ayushman_rmos
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID
    REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
