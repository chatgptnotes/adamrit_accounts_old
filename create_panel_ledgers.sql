-- Create receivable ledgers for the 43 panels that had none, and map them.
--
-- Of 59 panels, 14 already had a usable ledger and were mapped by
-- map_panels_to_ledgers.sql. Two entries ('private', 'Private') are not panels
-- at all and are deliberately skipped - private patients settle on discharge
-- and owe nothing. That leaves 43.
--
-- Naming follows the conventions already in the chart:
--   government schemes   Full Name (ACRONYM)   as in CGHS, MPKAY
--   well-known bodies    bare acronym          as in ESIC, ECHS, WCL
--   companies and TPAs   trading name, with Pvt/Ltd/Co suffixes dropped,
--                        as in Reliance General Insurance, Paramount
--
-- Codes sit in the 14xx debtors block alongside 1400 Patient Debtors:
--   1411-1419  government schemes
--   1421-1429  public sector and corporates
--   1431-1449  TPAs and insurers
--
-- All are CURRENT_ASSETS under Sundry Debtors, which is the exact string
-- heads.ts maps to the Current Assets primary group, and all belong to DRM
-- Hope Pvt Ltd - the only panel contracted with the legacy partnership is WCL,
-- which already has its ledger.
--
-- Two panels share one ledger by design: 'Generis TPA' and 'Unique Healthcare &
-- Medical Services Pvt. Ltd. (Generis TPA)' are the trading and legal names of
-- the same TPA. Vision Emedi and Vision Health are kept separate pending
-- confirmation that they are not also the same company renamed.
--
-- To undo:
--   UPDATE corporate SET ledger_account_id = NULL
--    WHERE ledger_account_id IN (SELECT id FROM chart_of_accounts
--                                 WHERE account_code BETWEEN '1411' AND '1449');
--   DELETE FROM chart_of_accounts WHERE account_code BETWEEN '1411' AND '1449';

WITH new_ledgers(account_code, account_name) AS (VALUES
  -- government schemes
  ('1411', 'Pradhan Mantri Jan Arogya Yojana (PMJAY)'),
  ('1412', 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)'),
  ('1413', 'Rashtriya Bal Swasthya Karyakram (RBSK)'),
  ('1414', 'Maharashtra Dharmadaya Karmachari Kutumb Arogya Yojana (MDKKSY)'),
  ('1415', 'MP State Government Employees (OST)'),
  ('1416', 'Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana (MIKSSKAY)'),
  -- public sector and corporates
  ('1421', 'Coal India Ltd (CIL)'),
  ('1422', 'MECL'),
  ('1423', 'Reserve Bank of India (RBI)'),
  ('1424', 'Ordnance Factories'),
  ('1425', 'Gun Factory'),
  ('1426', 'Maharashtra Metro Rail Corporation'),
  ('1427', 'AFCON Ltd'),
  ('1428', 'ITD Cementation Ltd'),
  ('1429', 'NVGT Care Services'),
  ('1430', 'Maharashtra State Electricity Board (MSEB)'),
  -- railways (distinct debtors from Central Railway, which already exists)
  ('1431', 'South Eastern Central Railway (SECR)'),
  ('1432', 'West Central Railway'),
  -- TPAs and insurers
  ('1433', 'Generis TPA'),
  ('1434', 'United Healthcare India'),
  ('1435', 'Vidal Health TPA'),
  ('1436', 'Vision Emedi TPA'),
  ('1437', 'Vision Health TPA'),
  ('1438', 'Acko Insurance India'),
  ('1439', 'AKNA Health Insurance TPA'),
  ('1440', 'Chola MS Health Insurance'),
  ('1441', 'Family Health Plan Insurance TPA'),
  ('1442', 'Go Digit Health Insurance'),
  ('1443', 'HDFC ERGO Insurance'),
  ('1444', 'Health India Insurance TPA'),
  ('1445', 'ICICI Lombard General Insurance'),
  ('1446', 'MD India Health Insurance'),
  ('1447', 'MaxBupa Health Insurance'),
  ('1448', 'Raksha Health Insurance TPA'),
  ('1449', 'Reliance Health Insurance'),
  ('1450', 'Royal Sundaram Alliance Insurance'),
  ('1451', 'Star Health And Allied Insurance'),
  ('1452', 'TATA AIG General Insurance'),
  ('1453', 'United Health Care Parekh Insurance TPA'),
  ('1454', 'VOLO Health Insurance TPA'),
  ('1455', 'Zurich Kotak Insurance'),
  ('1456', 'Insurance - Unspecified')
)
INSERT INTO public.chart_of_accounts (
  account_code, account_name, account_type, account_group,
  opening_balance, opening_balance_type, is_active, company_id
)
SELECT n.account_code, n.account_name, 'CURRENT_ASSETS', 'Sundry Debtors',
       0, 'DR', true,
       (SELECT id FROM public.companies WHERE company_key = 'drm_pvt_ltd')
  FROM new_ledgers n
ON CONFLICT (account_code) DO NOTHING;


-- Point each panel at its new ledger.
UPDATE public.corporate c
   SET ledger_account_id = a.id,
       updated_at        = now()
  FROM (VALUES
    ('Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)',            '1411'),
    ('Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)',                     '1412'),
    ('Rashtriya Bal Swasthya Karyakram (RBSK)',                               '1413'),
    ('Maharashtra Dharmadaya Karmachari Kutumbe Seashya Yojana (MDKKSY)',     '1414'),
    ('MP State Government Employees-OST empanelled hospital',                 '1415'),
    ('MIKSSKAY - Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana','1416'),
    ('Coal India Limited (CIL)',                                              '1421'),
    ('MECL (Mineral Exploration Corporation Ltd)',                            '1422'),
    ('RBI (Reserve Bank of India)',                                           '1423'),
    ('Ordnance Factories (Ambazari, Chanda, Jawaher Nagar, Itarsi)',          '1424'),
    ('Gun Factory',                                                           '1425'),
    ('Maharashtra Metro Rail Corporation',                                    '1426'),
    ('AFCON Ltd (Nagpur Metro Work)',                                         '1427'),
    ('ITD Cementation Ltd (Nagpur Metro Work)',                               '1428'),
    ('NVGT Care Services Pvt Ltd',                                            '1429'),
    ('Maharashtra State Electricity Board (MSEB)',                            '1430'),
    ('South Eastern Central Railway (SECR)',                                  '1431'),
    ('West Central Railway',                                                  '1432'),
    ('Generis TPA',                                                           '1433'),
    ('Unique Healthcare & Medical Services Pvt. Ltd. (Generis TPA)',          '1433'),
    ('United Healthcare India Pvt. Ltd.',                                     '1434'),
    ('Vidal Health TPA Pvt. Ltd.',                                            '1435'),
    ('Vision Emedi TPA Pvt. Ltd.',                                            '1436'),
    ('Vision Health TPA Ltd.',                                                '1437'),
    ('Acko Insurance India',                                                  '1438'),
    ('AKNA HEALTH INSURANCE TPA',                                             '1439'),
    ('CHOLA MS HEALTH INSURANCE',                                             '1440'),
    ('Family Health Plan Insurance (TPA) Ltd.',                               '1441'),
    ('Go Digit Health Insurance',                                             '1442'),
    ('HDFC ERGO Insurance Co Ltd.',                                           '1443'),
    ('Health India Insurance TPA Pvt. Ltd.',                                  '1444'),
    ('ICICI Lombard General Insurance Pvt. Ltd.',                             '1445'),
    ('MD India Health Insurance Pvt. Ltd.',                                   '1446'),
    ('MaxBupa Health Insurance Co. Ltd.',                                     '1447'),
    ('Raksha Health Insurance TPA Ltd.',                                      '1448'),
    ('Reliance Health Insurance Pvt. Ltd.',                                   '1449'),
    ('Royal Sundaram Alliance Insurance Co. Ltd',                             '1450'),
    ('Star Heath An Allied Insurance Company',                                '1451'),
    ('TATA AIG General Insurance Co. Ltd.',                                   '1452'),
    ('United Health Care Parekh Insurance TPA Pvt. Ltd.',                     '1453'),
    ('VOLO HEALTH INSURANCE TPA PVT. LTD.',                                   '1454'),
    ('ZURICH  KOTAK INSURANCE',                                               '1455'),
    ('Insurance',                                                             '1456')
  ) AS m(panel, ledger_code)
  JOIN public.chart_of_accounts a ON a.account_code = m.ledger_code
 WHERE lower(btrim(c.name)) = lower(btrim(m.panel));


-- Outcome: every panel except the two 'private' entries should now be mapped.
SELECT CASE WHEN c.ledger_account_id IS NULL THEN 'STILL UNMAPPED' ELSE 'mapped' END AS state,
       count(*) AS panels,
       string_agg(CASE WHEN c.ledger_account_id IS NULL THEN c.name END, ', ') AS which
  FROM public.corporate c
 GROUP BY 1
 ORDER BY 1;
