-- Anaesthetist Charges (Dr. Mona Basantwani).
--
-- Anaesthetists' fees were posting to "Surgeon Fees". Create an
-- "Anaesthetist Charges" expense ledger in each hospital company and point
-- every Dr. Mona mapping (all spelling variants) at it, so her OT bills —
-- and the JVs they post — read as anaesthetist charges. The OT auto-feed
-- now also prefers this ledger for any anaesthetist.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

DO $seed$
DECLARE
  v_company RECORD;
  v_ledger  UUID;
  v_code    TEXT;
BEGIN
  FOR v_company IN
    SELECT id, company_key FROM public.companies
     WHERE company_key IN ('drm_pvt_ltd', 'ayushman_nagpur')
  LOOP
    SELECT id INTO v_ledger
      FROM public.chart_of_accounts
     WHERE company_id = v_company.id AND is_active
       AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
         = 'anaesthetist charges'
     ORDER BY created_at LIMIT 1;
    IF v_ledger IS NULL THEN
      v_code := 'ANCH' || upper(substr(md5(v_company.id::text || 'anaesthetist-charges'), 1, 8));
      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group, company_id,
         is_active, opening_balance, opening_balance_type)
      VALUES
        (v_code, 'Anaesthetist Charges', 'DIRECT_EXPENSES', 'Direct Expenses',
         v_company.id, true, 0, 'DR')
      ON CONFLICT (account_code) DO NOTHING;
      SELECT id INTO v_ledger FROM public.chart_of_accounts WHERE account_code = v_code;
      RAISE NOTICE 'Created Anaesthetist Charges in %', v_company.company_key;
    END IF;

    -- Every Dr. Mona mapping in this company now expenses to it.
    UPDATE public.doctor_ledger_map
       SET expense_account_id = v_ledger, updated_at = now()
     WHERE company_id = v_company.id
       AND surgeon_name ILIKE '%mona%'
       AND (expense_account_id IS DISTINCT FROM v_ledger);
  END LOOP;
END;
$seed$;

-- Proof: no Mona mapping still points at Surgeon Fees, and the ledger exists.
DO $verify$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.doctor_ledger_map m
    JOIN public.chart_of_accounts a ON a.id = m.expense_account_id
   WHERE m.surgeon_name ILIKE '%mona%'
     AND lower(btrim(a.account_name)) <> 'anaesthetist charges';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% Dr. Mona mapping(s) still expense elsewhere', v_bad;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE is_active AND lower(btrim(account_name)) = 'anaesthetist charges'
  ) THEN
    RAISE EXCEPTION 'Anaesthetist Charges ledger was not created';
  END IF;
  RAISE NOTICE 'OK — Dr. Mona expenses to Anaesthetist Charges in every mapping';
END;
$verify$;

COMMIT;
