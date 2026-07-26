-- Map panels to their receivable ledgers, so an approved bill transfers the
-- amount owed from the patient to the panel that is actually going to pay.
--
-- 14 of 59 panels, reviewed and approved 2026-07-26. The rest were deliberately
-- left unmapped:
--
--  * 20 panels have no receivable ledger at all - MJPJAY, PM-JAY, RBSK, MDKKSY,
--    Coal India, Ordnance Factories, Maharashtra Metro and most TPAs. An
--    account has to be created for each before it can be mapped.
--  * 20 automatic suggestions pointed at EXPENSE accounts. Every insurance TPA
--    matched '5270 Insurance', which is the premiums the hospital pays, and
--    MSEB matched '5230 Electricity'. Mapping a panel there would post
--    receivables into expenses.
--  * South Eastern Central Railway and West Central Railway both matched
--    'Central Railway'. They are different railways and different debtors.
--  * 'private' and 'Private' are not panels. Private patients settle on
--    discharge and owe nothing, so they must stay unmapped.
--
-- Matching is by exact ledger code rather than by name, so a later rename
-- cannot silently repoint a panel at the wrong account.
--
-- To undo:
--   UPDATE corporate SET ledger_account_id = NULL
--    WHERE name IN (SELECT panel FROM ...);  -- or simply clear all 14 by name

UPDATE public.corporate c
   SET ledger_account_id = a.id,
       updated_at        = now()
  FROM (VALUES
    ('Bajaj Allianz General Insurance',                       'TL5a9cc00hr9zdu'),
    ('CAPF',                                                  'TL5a9cc01ewi0iv'),
    ('Central Government Health Scheme (CGHS)',               'DRMFRESH_000300'),
    ('CGHS',                                                  'DRMFRESH_000300'),
    ('Central Railways (C.Rly)',                              'DRMFRESH_000301'),
    ('ECHS',                                                  'TL5a9cc01hx8qmo'),
    ('Ex Serviceman Contributory Health Scheme (ECHS)',       'TL5a9cc01hx8qmo'),
    ('esic',                                                  'TL5a9cc0102g4ih'),
    ('Maharashtra Police Kutumb Arogya Yojana (MPKAY)',       'DRMFRESH_000906'),
    ('MP Police (Swasthya Suraksha Nyas)',                    'TL5a9cc01w7x7hq'),
    ('Paramount Health Services and Insurance TPA Pvt. Ltd.', 'DRMFRESH_001148'),
    ('Reliance General Insurance Co. Ltd.',                   'DRMFRESH_001361'),
    ('Universal Sompo general insurance',                     'DRMFRESH_001769'),
    ('Western Coalfield Limited (WCL)',                       'TL5a9cc00m84q2h')
  ) AS m(panel, ledger_code)
  JOIN public.chart_of_accounts a ON a.account_code = m.ledger_code
 WHERE lower(btrim(c.name)) = lower(btrim(m.panel));


-- Outcome. mapped_to should be filled for all 14; anything still showing
-- '-- still unmapped --' did not match a panel name and needs looking at.
SELECT m.panel,
       COALESCE(a.account_name, '-- still unmapped --') AS mapped_to,
       COALESCE(a.account_group, '-')                   AS account_group,
       COALESCE(co.company_name, '-')                   AS company
  FROM (VALUES
    ('Bajaj Allianz General Insurance'),
    ('CAPF'),
    ('Central Government Health Scheme (CGHS)'),
    ('CGHS'),
    ('Central Railways (C.Rly)'),
    ('ECHS'),
    ('Ex Serviceman Contributory Health Scheme (ECHS)'),
    ('esic'),
    ('Maharashtra Police Kutumb Arogya Yojana (MPKAY)'),
    ('MP Police (Swasthya Suraksha Nyas)'),
    ('Paramount Health Services and Insurance TPA Pvt. Ltd.'),
    ('Reliance General Insurance Co. Ltd.'),
    ('Universal Sompo general insurance'),
    ('Western Coalfield Limited (WCL)')
  ) AS m(panel)
  LEFT JOIN public.corporate c
    ON lower(btrim(c.name)) = lower(btrim(m.panel))
  LEFT JOIN public.chart_of_accounts a ON a.id = c.ledger_account_id
  LEFT JOIN public.companies co        ON co.id = c.company_id
 ORDER BY (a.id IS NULL) DESC, m.panel;
