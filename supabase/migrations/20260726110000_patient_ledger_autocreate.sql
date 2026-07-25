-- Give every patient their own ledger in the accounting module.
--
-- A "patient ledger" is two rows:
--   1. chart_of_accounts  — the ledger the accounting reports actually read
--                           (Trial Balance, Balance Sheet, Ledger Vouchers all
--                           go through mergedLedgerBalances → chart_of_accounts).
--   2. patient_ledgers    — the debtor card voucher_entries.patient_ledger_id
--                           points at. The table has existed since
--                           20250612230000 with no writer.
--
-- Created by trigger rather than in the registration form because nine separate
-- code paths insert into `patients` and only three of them generate a UID
-- (usePatientRegistration.ts, RegisterPatientFlow.tsx, AddEmergencyPatientDialog.tsx).
-- The rest — AddPatientDialog, CameraUpload's OPD flow, the CSV importers —
-- create the patient first and get a UID later, if at all.
--
-- Depends on `companies` and `chart_of_accounts.company_id` from
-- MULTI_COMPANY_MIGRATION.sql, which lives outside this folder.

CREATE OR REPLACE FUNCTION public.create_patient_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_ledger_name TEXT;
  v_company_id UUID;
BEGIN
  -- No UID yet: the patient row exists but has nothing to key a ledger on.
  -- The UPDATE OF patients_id branch picks it up when one is assigned.
  IF NEW.patients_id IS NULL OR btrim(NEW.patients_id) = '' THEN
    RETURN NEW;
  END IF;

  -- `UPDATE OF` fires whenever the column is in the SET list, changed or not.
  IF TG_OP = 'UPDATE'
     AND NEW.patients_id IS NOT DISTINCT FROM OLD.patients_id
     AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;

  -- The UID in the name is mandatory, not decoration: mergedLedgerBalances
  -- merges rows by normalized name, so two patients called "Ramesh Kumar"
  -- would collapse into a single ledger row carrying both their balances.
  v_ledger_name := COALESCE(NULLIF(btrim(NEW.name), ''), 'Unnamed Patient')
                   || ' (' || NEW.patients_id || ')';

  SELECT id INTO v_company_id
    FROM companies
   WHERE company_key = CASE lower(COALESCE(NEW.hospital_name, 'hope'))
                         WHEN 'ayushman' THEN 'ayushman_nagpur'
                         ELSE 'hope_partnership'
                       END;

  -- account_group 'Sundry Debtors' is the exact string heads.ts maps to the
  -- Current Assets primary group, matching the imported DRM payer ledgers.
  INSERT INTO chart_of_accounts (
    account_code, account_name, account_type, account_group,
    opening_balance, opening_balance_type, is_active, company_id
  )
  VALUES (
    'PT' || NEW.patients_id, v_ledger_name, 'CURRENT_ASSETS', 'Sundry Debtors',
    0, 'DR', true, v_company_id
  )
  ON CONFLICT (account_code) DO UPDATE
    SET account_name = EXCLUDED.account_name,
        updated_at = now()
  RETURNING id INTO v_account_id;

  INSERT INTO patient_ledgers (
    patient_id, account_id, ledger_name, opening_balance, current_balance
  )
  VALUES (NEW.id, v_account_id, v_ledger_name, 0, 0)
  ON CONFLICT (patient_id) DO UPDATE
    SET ledger_name = EXCLUDED.ledger_name,
        account_id = EXCLUDED.account_id,
        updated_at = now();

  RETURN NEW;
END;
$$;

-- A UID edit (EditPatientDialog exposes patients_id as a form field) points the
-- patient at a fresh ledger and leaves the old one standing. That is deliberate:
-- the old ledger may already carry posted vouchers, and deleting it would orphan
-- their entries.
DROP TRIGGER IF EXISTS trg_create_patient_ledger ON public.patients;
CREATE TRIGGER trg_create_patient_ledger
AFTER INSERT OR UPDATE OF patients_id, name ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.create_patient_ledger();

-- Backfill every patient already holding a UID.
INSERT INTO chart_of_accounts (
  account_code, account_name, account_type, account_group,
  opening_balance, opening_balance_type, is_active, company_id
)
SELECT 'PT' || p.patients_id,
       COALESCE(NULLIF(btrim(p.name), ''), 'Unnamed Patient') || ' (' || p.patients_id || ')',
       'CURRENT_ASSETS',
       'Sundry Debtors',
       0,
       'DR',
       true,
       c.id
  FROM patients p
  LEFT JOIN companies c
    ON c.company_key = CASE lower(COALESCE(p.hospital_name, 'hope'))
                         WHEN 'ayushman' THEN 'ayushman_nagpur'
                         ELSE 'hope_partnership'
                       END
 WHERE p.patients_id IS NOT NULL
   AND btrim(p.patients_id) <> ''
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO patient_ledgers (
  patient_id, account_id, ledger_name, opening_balance, current_balance
)
SELECT p.id, a.id, a.account_name, 0, 0
  FROM patients p
  JOIN chart_of_accounts a
    ON a.account_code = 'PT' || p.patients_id
 WHERE p.patients_id IS NOT NULL
   AND btrim(p.patients_id) <> ''
ON CONFLICT (patient_id) DO NOTHING;
