-- Per the owner's decision: "Cash (HOPE)" and "Cash at Almirah" are the same
-- cash as each company's "Cash". Fold both in with the audited merge.
DO $$
DECLARE company RECORD; survivor UUID; loser RECORD;
BEGIN
  FOR company IN SELECT DISTINCT company_id FROM public.chart_of_accounts
                  WHERE company_id IS NOT NULL LOOP
    SELECT id INTO survivor FROM public.chart_of_accounts
     WHERE company_id = company.company_id AND is_active
       AND lower(btrim(account_name)) = 'cash'
     ORDER BY created_at LIMIT 1;
    IF survivor IS NULL THEN CONTINUE; END IF;
    FOR loser IN
      SELECT id FROM public.chart_of_accounts
       WHERE company_id = company.company_id AND is_active AND id <> survivor
         AND regexp_replace(lower(btrim(account_name)), '[^a-z]', '', 'g')
             IN ('cashhope', 'cashatalmirah')
    LOOP
      PERFORM public.merge_ledger(loser.id, survivor);
    END LOOP;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
