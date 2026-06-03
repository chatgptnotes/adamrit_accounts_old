-- Referral Amount is now entered manually, so the per-row Referral % column is
-- no longer used by the Relationship Manager > Referral Register table. Drop it.

alter table public.referral_register
  drop column if exists referral_percent;

notify pgrst, 'reload schema';
