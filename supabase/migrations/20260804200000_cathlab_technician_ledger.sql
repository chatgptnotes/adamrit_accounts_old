-- Cath lab technicians must map to their party ledger — the assistant bill
-- posts Cr to this account, so the master refuses to save without it.

ALTER TABLE public.cathlab_technicians
  ADD COLUMN IF NOT EXISTS party_account_id UUID
    REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
