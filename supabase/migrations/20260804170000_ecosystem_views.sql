-- Ecosystem data contracts #2 and #3: the read-only views the sister apps
-- consume over Adamrit's REST API, following the ecosystem_rmo_doctors
-- pattern (20260804160000). Adamrit stays the single writer; sister apps read.

-- ---------------------------------------------------------------------------
-- ecosystem_receivables — for Zero Risk (zeroriskagent.com).
-- Every active sundry-debtor ledger with its live outstanding balance
-- (opening + authorised voucher movement, Dr positive). Zero Risk turns
-- these into recovery cases.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ecosystem_receivables AS
SELECT
  coa.id AS ledger_id,
  c.company_name,
  coa.account_name AS party_name,
  coa.account_code AS ledger_code,
  ROUND(
    (COALESCE(coa.opening_balance, 0)
      * CASE WHEN UPPER(COALESCE(coa.opening_balance_type, 'DR')) = 'CR' THEN -1 ELSE 1 END)
    + COALESCE(m.net, 0), 2) AS outstanding,
  m.last_movement
FROM public.chart_of_accounts coa
LEFT JOIN public.companies c ON c.id = coa.company_id
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(ve.debit_amount, 0) - COALESCE(ve.credit_amount, 0)) AS net,
         MAX(v.voucher_date) AS last_movement
    FROM public.voucher_entries ve
    JOIN public.vouchers v ON v.id = ve.voucher_id AND v.status = 'AUTHORISED'
   WHERE ve.account_id = coa.id
) m ON TRUE
WHERE coa.is_active
  AND coa.account_group ILIKE '%debtor%'
  AND ABS(
    (COALESCE(coa.opening_balance, 0)
      * CASE WHEN UPPER(COALESCE(coa.opening_balance_type, 'DR')) = 'CR' THEN -1 ELSE 1 END)
    + COALESCE(m.net, 0)) >= 0.5;

-- ---------------------------------------------------------------------------
-- ecosystem_patients / ecosystem_visits — for DDO (ddo.center).
-- The minimum demographic + visit context the ABDM-compliant doctor
-- workspace needs to anchor a record to an Adamrit patient.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ecosystem_patients AS
SELECT id, patients_id AS patient_code, name, age, gender, phone,
       hospital_name, corporate
  FROM public.patients;

CREATE OR REPLACE VIEW public.ecosystem_visits AS
SELECT id, visit_id AS visit_code, patient_id, patient_type,
       visit_date, admission_date, discharge_date
  FROM public.visits;

GRANT SELECT ON public.ecosystem_receivables, public.ecosystem_patients,
                public.ecosystem_visits TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT (SELECT count(*) FROM public.ecosystem_receivables) AS receivable_parties,
       (SELECT count(*) FROM public.ecosystem_patients) AS patients,
       (SELECT count(*) FROM public.ecosystem_visits) AS visits;
