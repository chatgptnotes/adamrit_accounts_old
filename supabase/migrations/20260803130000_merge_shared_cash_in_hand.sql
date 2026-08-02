-- The remaining duplicate is the SHARED "Cash in Hand" (company_id IS NULL),
-- visible in every company's books. Its entries move to each voucher's own
-- company's "Cash"; the shared ledger is then deactivated as a stub.
DO $$
DECLARE shared_id UUID; company RECORD; cash_id UUID;
BEGIN
  SELECT id INTO shared_id FROM public.chart_of_accounts
   WHERE company_id IS NULL AND is_active
     AND regexp_replace(lower(btrim(account_name)),'[^a-z]','','g')='cashinhand'
   LIMIT 1;
  IF shared_id IS NULL THEN RETURN; END IF;
  FOR company IN SELECT DISTINCT v.company_id
                   FROM public.voucher_entries e JOIN public.vouchers v ON v.id=e.voucher_id
                  WHERE e.account_id=shared_id AND v.company_id IS NOT NULL LOOP
    SELECT id INTO cash_id FROM public.chart_of_accounts
     WHERE company_id=company.company_id AND is_active AND lower(btrim(account_name))='cash'
     ORDER BY created_at LIMIT 1;
    IF cash_id IS NULL THEN CONTINUE; END IF;
    UPDATE public.voucher_entries e SET account_id=cash_id
      FROM public.vouchers v
     WHERE v.id=e.voucher_id AND e.account_id=shared_id AND v.company_id=company.company_id;
  END LOOP;
  UPDATE public.chart_of_accounts
     SET is_active=false, opening_balance=0,
         account_name=account_name||' (merged '||to_char(now(),'DD Mon YY')||')'
   WHERE id=shared_id;
END $$;
NOTIFY pgrst, 'reload schema';
