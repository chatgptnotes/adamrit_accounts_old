-- Enter what each panel owed the hospital on 24 July 2026.
--
-- Fill in the amounts below. Leave a panel at 0.00 and it is skipped, so only
-- the panels that actually owe something get a voucher.
--
-- Each one posts a Journal voucher dated 25 Jul 2026:
--     Dr  <panel ledger>        the amount owed
--         Cr  Reserve & Surplus     same amount
--
-- Reserves rather than income, because the money was earned in an earlier
-- period and simply never recorded - agreed with the accountant 2026-07-26.
--
-- The ledger and the company are looked up from the panel record, so WCL
-- automatically posts under Hope Hospitals partnership and everything else
-- under DRM Hope Pvt Ltd. You do not need to set the company yourself.
--
-- Amounts are summed per ledger, so 'Generis TPA' and 'Unique Healthcare &
-- Medical Services Pvt. Ltd. (Generis TPA)' correctly land on one voucher.
--
-- Re-running is safe: a panel already posted is skipped.
--
-- To undo the whole batch:
--   UPDATE vouchers SET status = 'CANCELLED'
--    WHERE reference_number LIKE 'PANEL-OB-%' AND status <> 'CANCELLED';

WITH amounts(panel, amount) AS (VALUES
  ('AFCON Ltd (Nagpur Metro Work)'                                         , 0.00),
  ('AKNA HEALTH INSURANCE TPA'                                             , 0.00),
  ('Acko Insurance India'                                                  , 0.00),
  ('Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)'            , 0.00),
  ('Bajaj Allianz General Insurance'                                       , 0.00),
  ('CAPF'                                                                  , 0.00),
  ('CGHS'                                                                  , 0.00),
  ('CHOLA MS HEALTH INSURANCE'                                             , 0.00),
  ('Central Government Health Scheme (CGHS)'                               , 0.00),
  ('Central Railways (C.Rly)'                                              , 0.00),
  ('Coal India Limited (CIL)'                                              , 0.00),
  ('ECHS'                                                                  , 0.00),
  ('Ex Serviceman Contributory Health Scheme (ECHS)'                       , 0.00),
  ('Family Health Plan Insurance (TPA) Ltd.'                               , 0.00),
  ('Generis TPA'                                                           , 0.00),
  ('Go Digit Health Insurance'                                             , 0.00),
  ('Gun Factory'                                                           , 0.00),
  ('HDFC ERGO Insurance Co Ltd.'                                           , 0.00),
  ('Health India Insurance TPA Pvt. Ltd.'                                  , 0.00),
  ('ICICI Lombard General Insurance Pvt. Ltd.'                             , 0.00),
  ('ITD Cementation Ltd (Nagpur Metro Work)'                               , 0.00),
  ('Insurance'                                                             , 0.00),
  ('MD India Health Insurance Pvt. Ltd.'                                   , 0.00),
  ('MECL (Mineral Exploration Corporation Ltd)'                            , 0.00),
  ('MIKSSKAY - Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana', 0.00),
  ('MP Police (Swasthya Suraksha Nyas)'                                    , 0.00),
  ('MP State Government Employees-OST empanelled hospital'                 , 0.00),
  ('Maharashtra Dharmadaya Karmachari Kutumbe Seashya Yojana (MDKKSY)'     , 0.00),
  ('Maharashtra Metro Rail Corporation'                                    , 0.00),
  ('Maharashtra Police Kutumb Arogya Yojana (MPKAY)'                       , 0.00),
  ('Maharashtra State Electricity Board (MSEB)'                            , 0.00),
  ('Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)'                     , 0.00),
  ('MaxBupa Health Insurance Co. Ltd.'                                     , 0.00),
  ('NVGT Care Services Pvt Ltd'                                            , 0.00),
  ('Ordnance Factories (Ambazari, Chanda, Jawaher Nagar, Itarsi)'          , 0.00),
  ('Paramount Health Services and Insurance TPA Pvt. Ltd.'                 , 0.00),
  ('RBI (Reserve Bank of India)'                                           , 0.00),
  ('Raksha Health Insurance TPA Ltd.'                                      , 0.00),
  ('Rashtriya Bal Swasthya Karyakram (RBSK)'                               , 0.00),
  ('Reliance General Insurance Co. Ltd.'                                   , 0.00),
  ('Reliance Health Insurance Pvt. Ltd.'                                   , 0.00),
  ('Royal Sundaram Alliance Insurance Co. Ltd'                             , 0.00),
  ('South Eastern Central Railway (SECR)'                                  , 0.00),
  ('Star Heath An Allied Insurance Company'                                , 0.00),
  ('TATA AIG General Insurance Co. Ltd.'                                   , 0.00),
  ('Unique Healthcare & Medical Services Pvt. Ltd. (Generis TPA)'          , 0.00),
  ('United Health Care Parekh Insurance TPA Pvt. Ltd.'                     , 0.00),
  ('United Healthcare India Pvt. Ltd.'                                     , 0.00),
  ('Universal Sompo general insurance'                                     , 0.00),
  ('VOLO HEALTH INSURANCE TPA PVT. LTD.'                                   , 0.00),
  ('Vidal Health TPA Pvt. Ltd.'                                            , 0.00),
  ('Vision Emedi TPA Pvt. Ltd.'                                            , 0.00),
  ('Vision Health TPA Ltd.'                                                , 0.00),
  ('West Central Railway'                                                  , 0.00),
  ('Western Coalfield Limited (WCL)'                                       , 0.00),
  ('ZURICH  KOTAK INSURANCE'                                               , 0.00),
  ('esic'                                                                  , 0.00)
),
resolved AS (
  SELECT c.ledger_account_id            AS ledger_id,
         c.company_id,
         a.account_code,
         round(sum(x.amount), 2)        AS amount
    FROM amounts x
    JOIN corporate c ON lower(btrim(c.name)) = lower(btrim(x.panel))
    JOIN chart_of_accounts a ON a.id = c.ledger_account_id
   WHERE x.amount > 0
   GROUP BY 1, 2, 3
),
jtype AS (
  SELECT id, voucher_type_code FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 WHEN 'JOU' THEN 2 ELSE 3 END
   LIMIT 1
),
reserves AS (
  SELECT id FROM chart_of_accounts WHERE account_code = 'DRMFRESH_001367'
),
ins AS (
  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  )
  SELECT gen_random_uuid(),
         generate_voucher_number(j.voucher_type_code),
         j.id,
         DATE '2026-07-25',
         'PANEL-OB-' || r.account_code,
         'Opening receivable as at 24 Jul 2026',
         r.amount,
         r.company_id,
         'AUTHORISED',
         'panel-opening-balances',
         NOW(), NOW()
    FROM resolved r CROSS JOIN jtype j
   WHERE NOT EXISTS (
     SELECT 1 FROM vouchers v
      WHERE v.reference_number = 'PANEL-OB-' || r.account_code
        AND v.status <> 'CANCELLED')
  RETURNING id AS voucher_id, reference_number, total_amount
)
INSERT INTO voucher_entries (
  id, voucher_id, account_id, narration, debit_amount, credit_amount,
  entry_order, created_at
)
SELECT gen_random_uuid(),
       i.voucher_id,
       CASE WHEN l.leg = 1 THEN r.ledger_id ELSE res.id END,
       'Opening receivable as at 24 Jul 2026',
       CASE WHEN l.leg = 1 THEN i.total_amount ELSE 0 END,
       CASE WHEN l.leg = 2 THEN i.total_amount ELSE 0 END,
       l.leg,
       NOW()
  FROM ins i
  JOIN resolved r ON 'PANEL-OB-' || r.account_code = i.reference_number
  CROSS JOIN (VALUES (1), (2)) AS l(leg)
  CROSS JOIN reserves res;


-- What was posted, and the resulting panel balances.
SELECT a.account_name                                     AS panel_ledger,
       co.company_name                                    AS company,
       v.voucher_number,
       round(sum(e.debit_amount) - sum(e.credit_amount), 2) AS balance
  FROM vouchers v
  JOIN voucher_entries e   ON e.voucher_id = v.id
  JOIN chart_of_accounts a ON a.id = e.account_id
  LEFT JOIN companies co   ON co.id = v.company_id
 WHERE v.reference_number LIKE 'PANEL-OB-%'
   AND v.status <> 'CANCELLED'
   AND e.debit_amount > 0
 GROUP BY 1, 2, 3
 ORDER BY 4 DESC;
