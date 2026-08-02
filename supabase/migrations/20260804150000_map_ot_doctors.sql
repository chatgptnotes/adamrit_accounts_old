-- Map the five OT doctors to ledgers and complete their pending invoices.
-- Owner's decisions (2026-08-02): company follows the patient's hospital (all
-- eight cases are Hope -> DRM Hope Pvt Ltd); "Dr. Nanda Gavli" is
-- Dr. Vishal Nandagawali; "Dr Murali sir" is Dr. B K Murali (Ortho); new
-- Consultant ledgers for Kamli / Sadawarthe / Sabir Raja; interim fees
-- panel 5000 / private 8000.

-- 1) New party ledgers in DRM Hope (4adfe31a), shaped like the existing
--    Consultant ledgers (Dr. Vishal Nandagawali, DRMFRESH_000582).
INSERT INTO public.chart_of_accounts
  (account_name, account_type, account_group, account_code, company_id, is_active, opening_balance, opening_balance_type)
SELECT v.name, 'CURRENT_LIABILITIES', 'Consultant', v.code,
       '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, true, 0, 'CR'
  FROM (VALUES
    ('Dr. Mahendra Kamli',  'SURGFEE_KAMLI'),
    ('Pranal Sadawarthe',   'SURGFEE_SADAWARTHE'),
    ('Dr. Sabir Raja',      'SURGFEE_SABIRRAJA')
  ) AS v(name, code)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.chart_of_accounts c
    WHERE c.company_id = '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid
      AND lower(c.account_name) = lower(v.name) AND c.is_active
 );

-- 2) Doctor -> ledger map (exact names as the OT screen writes them), so
--    future OT invoices carry ledgers automatically.
INSERT INTO public.doctor_ledger_map (surgeon_name, company_id, party_account_id, expense_account_id)
SELECT v.surgeon, '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid, p.id,
       '1e78b6de-32de-400f-83ea-68cd15f9497c'::uuid
  FROM (VALUES
    ('Dr. Nanda Gavli',    'Dr. Vishal Nandagawali'),
    ('Dr. Mahendra Kamli', 'Dr. Mahendra Kamli'),
    ('Pranal Sadawarthe',  'Pranal Sadawarthe'),
    ('Dr.Sabir Raja',      'Dr. Sabir Raja'),
    ('Dr Murali sir',      'Dr. B K Murali (Ortho)')
  ) AS v(surgeon, ledger)
  JOIN public.chart_of_accounts p
    ON p.company_id = '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid
   AND lower(p.account_name) = lower(v.ledger) AND p.is_active
ON CONFLICT ((lower(surgeon_name))) DO UPDATE
   SET company_id = EXCLUDED.company_id,
       party_account_id = EXCLUDED.party_account_id,
       expense_account_id = EXCLUDED.expense_account_id,
       updated_at = now();

-- 3) Complete the seven good pending invoices: DRM Hope company, the doctor's
--    ledger, Surgeon Fees expense, and the interim fee (private 8000 for the
--    one private patient's case, panel 5000 for the Yojana/CGHS cases).
UPDATE public.approval_queue q
   SET company_id = '4adfe31a-7073-49fe-bc18-90fd32e00e52'::uuid,
       party_account_id = m.party_account_id,
       expense_account_id = m.expense_account_id,
       amount = v.fee
  FROM (VALUES
    ('INV-2607-00005', 8000), ('INV-2607-00006', 8000),
    ('INV-2607-00007', 5000), ('INV-2607-00008', 5000),
    ('INV-2607-00011', 5000), ('INV-2607-00012', 5000),
    ('INV-2608-00013', 5000)
  ) AS v(invoice_no, fee),
       public.doctor_ledger_map m
 WHERE q.invoice_no = v.invoice_no
   AND lower(m.surgeon_name) = lower(q.party_name)
   AND q.status = 'PENDING';

-- 4) INV-2607-00004 was generated without a surgeon (the procedure landed in
--    the party field) — reject it; the OT case can regenerate a clean one.
UPDATE public.approval_queue
   SET status = 'REJECTED',
       rejection_reason = 'Generated without a surgeon name (party field holds the procedure). Regenerate from the OT case.'
 WHERE invoice_no = 'INV-2607-00004' AND status = 'PENDING';

-- What's ready to approve now
SELECT invoice_no, party_name, amount, status,
       (company_id IS NOT NULL AND party_account_id IS NOT NULL AND expense_account_id IS NOT NULL AND amount > 0) AS ready
  FROM public.approval_queue
 WHERE category = 'DOCTOR' AND ot_schedule_id IS NOT NULL
 ORDER BY invoice_no;
