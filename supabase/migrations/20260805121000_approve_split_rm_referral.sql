BEGIN;

CREATE OR REPLACE FUNCTION public.approve_daily_revenue_referral(
  p_entry_id UUID, p_bill_number TEXT, p_document_path TEXT,
  p_document_url TEXT, p_created_by TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_entry RECORD; v_alloc RECORD; v_hosp_company UUID; v_hosp_key TEXT;
  v_ml_company UUID; v_party UUID; v_expense UUID; v_debtor UUID;
  v_sales UUID; v_comm UUID; v_patient_type TEXT; v_bill_id UUID;
  v_type_id UUID; v_type_code TEXT; v_sales_vno TEXT; v_comm_vno TEXT;
  v_voucher_id UUID; v_narr TEXT; v_rm_names TEXT; v_alloc_total NUMERIC;
  v_alloc_count INT; v_order INT := 1;
BEGIN
  IF btrim(COALESCE(p_bill_number,''))='' THEN RAISE EXCEPTION 'A bill number is required'; END IF;
  IF p_document_path IS NULL OR p_document_url IS NULL THEN RAISE EXCEPTION 'The generated invoice document is required'; END IF;
  SELECT * INTO v_entry FROM daily_revenue_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This report row no longer exists'; END IF;
  IF v_entry.expense_bill_id IS NOT NULL THEN RAISE EXCEPTION 'This row has already been approved and invoiced'; END IF;
  IF v_entry.approval_id IS NOT NULL THEN RAISE EXCEPTION 'This row was already paid through the old approval flow'; END IF;
  IF COALESCE(v_entry.is_hidden,false) THEN RAISE EXCEPTION 'A hidden row cannot be approved'; END IF;
  IF COALESCE(v_entry.cut,0)<=0 THEN RAISE EXCEPTION 'This row has no cut to approve'; END IF;
  IF EXISTS(SELECT 1 FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id AND approval_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This row already has an RM allocation in the legacy approval flow';
  END IF;

  -- Legacy rows become one allocation on first approval.
  IF NOT EXISTS(SELECT 1 FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id) THEN
    IF btrim(COALESCE(v_entry.rm_name,''))='' OR upper(btrim(v_entry.rm_name))='DIRECT' THEN
      RAISE EXCEPTION 'Direct patients have no relationship manager to pay';
    END IF;
    INSERT INTO daily_revenue_rm_allocations(revenue_entry_id,relationship_manager_id,position,rm_name,rm_ledger_account_id,allocated_cut)
    SELECT v_entry.id,m.id,1,btrim(v_entry.rm_name),COALESCE(v_entry.rm_ledger_account_id,m.ledger_account_id),v_entry.cut
    FROM (SELECT 1) x LEFT JOIN relationship_managers m ON lower(btrim(m.name))=lower(btrim(v_entry.rm_name)) LIMIT 1;
  END IF;
  PERFORM rebalance_daily_revenue_rm_allocations(p_entry_id);
  SELECT count(*),sum(allocated_cut),string_agg(rm_name,', ' ORDER BY position)
    INTO v_alloc_count,v_alloc_total,v_rm_names
  FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id;
  IF v_alloc_count<1 OR v_alloc_count>3 OR v_alloc_total IS DISTINCT FROM v_entry.cut THEN
    RAISE EXCEPTION 'The RM allocation does not match this row total';
  END IF;
  IF EXISTS(SELECT 1 FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id AND rm_ledger_account_id IS NULL) THEN
    RAISE EXCEPTION 'Every relationship manager must have a ledger before approval';
  END IF;

  v_hosp_key:=CASE WHEN lower(COALESCE(v_entry.hospital_type,'')) LIKE '%ayush%' THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  SELECT id INTO v_hosp_company FROM companies WHERE company_key=v_hosp_key;
  SELECT id INTO v_ml_company FROM companies WHERE company_key='ml_enterprises';
  SELECT id INTO v_party FROM chart_of_accounts WHERE company_id=v_hosp_company AND is_active AND lower(btrim(account_name))='m.l. enterprises' LIMIT 1;
  SELECT id INTO v_expense FROM chart_of_accounts WHERE (company_id=v_hosp_company OR company_id IS NULL) AND is_active
    AND lower(btrim(account_name))='implant purchase' AND account_type IN ('DIRECT_EXPENSES','INDIRECT_EXPENSES') ORDER BY (company_id=v_hosp_company) DESC LIMIT 1;
  SELECT id INTO v_debtor FROM chart_of_accounts WHERE company_id=v_ml_company AND is_active AND lower(btrim(account_name))=
    CASE WHEN v_hosp_key='ayushman_nagpur' THEN 'ayushman hospital' ELSE 'hope hospital' END LIMIT 1;
  SELECT id INTO v_sales FROM chart_of_accounts WHERE company_id=v_ml_company AND is_active AND lower(btrim(account_name))='sales' LIMIT 1;
  SELECT id INTO v_comm FROM chart_of_accounts WHERE company_id=v_ml_company AND is_active AND lower(btrim(account_name))='referral commission' LIMIT 1;
  IF v_hosp_company IS NULL OR v_ml_company IS NULL OR v_party IS NULL OR v_expense IS NULL OR v_debtor IS NULL OR v_sales IS NULL OR v_comm IS NULL THEN
    RAISE EXCEPTION 'The M.L. Enterprises accounting setup is incomplete';
  END IF;
  IF EXISTS(
    SELECT 1 FROM daily_revenue_rm_allocations a LEFT JOIN chart_of_accounts c ON c.id=a.rm_ledger_account_id
    WHERE a.revenue_entry_id=p_entry_id AND (c.id IS NULL OR NOT c.is_active OR c.company_id IS DISTINCT FROM v_ml_company)
  ) THEN RAISE EXCEPTION 'Every RM ledger must be an active M.L. Enterprises ledger'; END IF;

  IF v_entry.visit_id IS NOT NULL THEN SELECT upper(COALESCE(patient_type,'')) INTO v_patient_type FROM visits WHERE id=v_entry.visit_id; END IF;
  IF v_patient_type IS NULL OR v_patient_type NOT IN ('OPD','IPD') THEN v_patient_type:='OPD'; END IF;
  v_narr:='Implant purchase — '||COALESCE(v_entry.patient_name,'patient')||' ('||v_patient_type||', RM '||v_rm_names||')';
  INSERT INTO expense_bills(bill_number,bill_date,party_ledger_id,expense_ledger_id,amount,narration,document_path,document_url,
    company_id,status,created_by,relationship_manager,patient_name,patient_type,revenue_entry_id)
  VALUES(btrim(p_bill_number),COALESCE(v_entry.entry_date,CURRENT_DATE),v_party,v_expense,v_entry.cut,v_narr,p_document_path,p_document_url,
    v_hosp_company,'POSTED',COALESCE(NULLIF(btrim(p_created_by),''),'drr-referral-approve'),v_rm_names,v_entry.patient_name,v_patient_type,v_entry.id)
  RETURNING id INTO v_bill_id;

  SELECT id,voucher_type_code INTO v_type_id,v_type_code FROM voucher_types WHERE voucher_category='JOURNAL' AND is_active
    ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END LIMIT 1;
  IF v_type_id IS NULL THEN RAISE EXCEPTION 'No active JOURNAL voucher type is configured'; END IF;

  v_voucher_id:=gen_random_uuid(); v_sales_vno:=generate_voucher_number(v_type_code);
  v_narr:='Sale of implant — '||COALESCE(v_entry.patient_name,'patient')||', invoice '||btrim(p_bill_number);
  INSERT INTO vouchers(id,voucher_number,voucher_type_id,voucher_date,reference_number,narration,total_amount,company_id,status,created_by,created_at,updated_at)
  VALUES(v_voucher_id,v_sales_vno,v_type_id,COALESCE(v_entry.entry_date,CURRENT_DATE),btrim(p_bill_number),v_narr,v_entry.cut,v_ml_company,'AUTHORISED',COALESCE(NULLIF(btrim(p_created_by),''),'drr-referral-approve'),now(),now());
  INSERT INTO voucher_entries(id,voucher_id,account_id,narration,debit_amount,credit_amount,entry_order,bill_ref,created_at) VALUES
    (gen_random_uuid(),v_voucher_id,v_debtor,v_narr,v_entry.cut,0,1,btrim(p_bill_number),now()),
    (gen_random_uuid(),v_voucher_id,v_sales,v_narr,0,v_entry.cut,2,NULL,now());

  v_voucher_id:=gen_random_uuid(); v_comm_vno:=generate_voucher_number(v_type_code);
  v_narr:='Referral commission '||v_rm_names||' — '||COALESCE(v_entry.patient_name,'patient')||', invoice '||btrim(p_bill_number);
  INSERT INTO vouchers(id,voucher_number,voucher_type_id,voucher_date,reference_number,narration,total_amount,company_id,status,created_by,created_at,updated_at)
  VALUES(v_voucher_id,v_comm_vno,v_type_id,COALESCE(v_entry.entry_date,CURRENT_DATE),btrim(p_bill_number),v_narr,v_entry.cut,v_ml_company,'AUTHORISED',COALESCE(NULLIF(btrim(p_created_by),''),'drr-referral-approve'),now(),now());
  INSERT INTO voucher_entries(id,voucher_id,account_id,narration,debit_amount,credit_amount,entry_order,bill_ref,created_at)
  VALUES(gen_random_uuid(),v_voucher_id,v_comm,v_narr,v_entry.cut,0,1,NULL,now());
  FOR v_alloc IN SELECT * FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id ORDER BY position LOOP
    v_order:=v_order+1;
    INSERT INTO voucher_entries(id,voucher_id,account_id,narration,debit_amount,credit_amount,entry_order,bill_ref,created_at)
    VALUES(gen_random_uuid(),v_voucher_id,v_alloc.rm_ledger_account_id,'Referral commission '||v_alloc.rm_name||' — '||COALESCE(v_entry.patient_name,'patient'),0,v_alloc.allocated_cut,v_order,btrim(p_bill_number),now());
  END LOOP;
  UPDATE daily_revenue_entries SET expense_bill_id=v_bill_id,updated_at=now() WHERE id=p_entry_id;
  RETURN jsonb_build_object('bill_id',v_bill_id,'bill_number',btrim(p_bill_number),'company_key',v_hosp_key,'sales_voucher',v_sales_vno,'commission_voucher',v_comm_vno);
END $$;

REVOKE ALL ON FUNCTION public.approve_daily_revenue_referral(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_daily_revenue_referral(UUID,TEXT,TEXT,TEXT,TEXT) TO anon,authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
