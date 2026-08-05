-- "On Behalf Of" payments between DRM Hope and Ayushman.
--
-- One hospital pays an expense that belongs to the other. The Payment
-- Voucher screen gains an "On Behalf Of <other company>" checkbox; saving it
-- posts BOTH sides in one transaction:
--
--   Paying company  (Payment Voucher):  Dr <other company>   / Cr Cash-Bank
--   Other company   (Journal Voucher):  Dr <expense ledger>  / Cr <paying company>
--
-- The JV carries linked_voucher_id -> the PV, so deleting the PV deletes the
-- JV (FK cascade) and editing the PV's amount/date/narration re-syncs the JV
-- (trigger below). Day Book needs no change: both vouchers are ordinary rows
-- in `vouchers`, each under its own company.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- ------------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------------
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS on_behalf_of_company_id UUID REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS linked_voucher_id UUID REFERENCES public.vouchers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS pay_to TEXT;

CREATE INDEX IF NOT EXISTS idx_vouchers_linked_voucher_id
  ON public.vouchers (linked_voucher_id) WHERE linked_voucher_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. The inter-company ledger a company keeps for its counterpart.
--    Found by exact (normalized) name match on the counterpart's company
--    name; created under Loans & Advances (Asset) if missing.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_intercompany_ledger(
  p_in_company UUID,
  p_counterparty UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_name   TEXT;
  v_id     UUID;
  v_code   TEXT;
BEGIN
  SELECT company_name INTO v_name FROM public.companies WHERE id = p_counterparty;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Counterparty company not found';
  END IF;

  SELECT id INTO v_id
    FROM public.chart_of_accounts
   WHERE company_id = p_in_company
     AND is_active = true
     AND lower(regexp_replace(account_name, '[^a-zA-Z0-9]+', '', 'g'))
       = lower(regexp_replace(v_name,       '[^a-zA-Z0-9]+', '', 'g'))
   ORDER BY created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- account_code is globally unique; derive a stable one from both ids so a
  -- concurrent second call lands on the same code and the unique index dedupes.
  v_code := 'IC' || upper(substr(md5(p_in_company::text || p_counterparty::text), 1, 8));
  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group, company_id, is_active)
  VALUES
    (v_code, v_name, 'CURRENT_ASSETS', 'Loans & Advances (Asset)', p_in_company, true)
  ON CONFLICT (account_code) DO NOTHING;

  SELECT id INTO v_id FROM public.chart_of_accounts WHERE account_code = v_code;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Could not create inter-company ledger "%" ', v_name;
  END IF;
  RETURN v_id;
END;
$function$;

-- ------------------------------------------------------------------
-- 3. Post both sides atomically
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_on_behalf_payment(
  p_paying_company_id UUID,
  p_behalf_company_id UUID,
  p_credit_account_id UUID,   -- cash/bank in the paying company's books
  p_expense_account_id UUID,  -- expense ledger in the other company's books
  p_amount NUMERIC,
  p_voucher_date DATE,
  p_pay_to TEXT DEFAULT NULL,
  p_narration TEXT DEFAULT NULL,
  p_user TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_paying_name  TEXT;
  v_behalf_name  TEXT;
  v_credit       RECORD;
  v_expense      RECORD;
  v_ic_paying    UUID;   -- "<behalf company>" ledger in paying books  (PV debit)
  v_ic_behalf    UUID;   -- "<paying company>" ledger in behalf books  (JV credit)
  v_pv_type_id   UUID; v_pv_type_code TEXT;
  v_jv_type_id   UUID; v_jv_type_code TEXT;
  v_pv_id        UUID := gen_random_uuid();
  v_jv_id        UUID := gen_random_uuid();
  v_pv_no        TEXT;
  v_jv_no        TEXT;
  v_pv_narr      TEXT;
  v_jv_narr      TEXT;
  v_user         TEXT := coalesce(nullif(btrim(p_user), ''), 'on-behalf-payment');
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_paying_company_id IS NULL OR p_behalf_company_id IS NULL
     OR p_paying_company_id = p_behalf_company_id THEN
    RAISE EXCEPTION 'The paying company and the on-behalf company must be two different companies';
  END IF;

  SELECT company_name INTO v_paying_name FROM public.companies WHERE id = p_paying_company_id;
  SELECT company_name INTO v_behalf_name FROM public.companies WHERE id = p_behalf_company_id;
  IF v_paying_name IS NULL OR v_behalf_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT id, account_name, company_id INTO v_credit
    FROM public.chart_of_accounts WHERE id = p_credit_account_id AND is_active = true;
  IF v_credit.id IS NULL THEN
    RAISE EXCEPTION 'Select the cash or bank ledger the payment goes out of';
  END IF;
  IF v_credit.company_id IS NOT NULL AND v_credit.company_id <> p_paying_company_id THEN
    RAISE EXCEPTION 'Ledger "%" belongs to another company — pick one from % ',
      v_credit.account_name, v_paying_name;
  END IF;

  SELECT id, account_name, company_id INTO v_expense
    FROM public.chart_of_accounts WHERE id = p_expense_account_id AND is_active = true;
  IF v_expense.id IS NULL THEN
    RAISE EXCEPTION 'Select the expense ledger the other company books this under';
  END IF;
  IF v_expense.company_id IS NOT NULL AND v_expense.company_id <> p_behalf_company_id THEN
    RAISE EXCEPTION 'Expense ledger "%" belongs to another company — pick one from % ',
      v_expense.account_name, v_behalf_name;
  END IF;

  v_ic_paying := public.ensure_intercompany_ledger(p_paying_company_id, p_behalf_company_id);
  v_ic_behalf := public.ensure_intercompany_ledger(p_behalf_company_id, p_paying_company_id);

  SELECT id, voucher_type_code INTO v_pv_type_id, v_pv_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_pv_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Payment voucher type is configured';
  END IF;

  SELECT id, voucher_type_code INTO v_jv_type_id, v_jv_type_code
    FROM public.voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;
  IF v_jv_type_id IS NULL THEN
    RAISE EXCEPTION 'No active Journal voucher type is configured';
  END IF;

  v_pv_no := public.generate_voucher_number(v_pv_type_code);
  v_jv_no := public.generate_voucher_number(v_jv_type_code);

  v_pv_narr := 'On behalf of ' || v_behalf_name
               || CASE WHEN nullif(btrim(p_pay_to), '') IS NOT NULL
                       THEN ', paid to ' || btrim(p_pay_to) ELSE '' END
               || ' (' || v_expense.account_name || ')'
               || CASE WHEN nullif(btrim(p_narration), '') IS NOT NULL
                       THEN ' — ' || btrim(p_narration) ELSE '' END
               || '. Journal ' || v_jv_no || ' in ' || v_behalf_name || '.';
  v_jv_narr := v_expense.account_name || ' paid by ' || v_paying_name || ' on our behalf'
               || CASE WHEN nullif(btrim(p_pay_to), '') IS NOT NULL
                       THEN ', paid to ' || btrim(p_pay_to) ELSE '' END
               || CASE WHEN nullif(btrim(p_narration), '') IS NOT NULL
                       THEN ' — ' || btrim(p_narration) ELSE '' END
               || '. Payment ' || v_pv_no || ' in ' || v_paying_name || '.';

  -- Payment voucher in the paying company's books
  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, is_auto,
    on_behalf_of_company_id, pay_to, created_by, created_at, updated_at
  ) VALUES (
    v_pv_id, v_pv_no, v_pv_type_id, p_voucher_date, v_jv_no,
    v_pv_narr, p_amount, p_paying_company_id, 'AUTHORISED', false,
    p_behalf_company_id, nullif(btrim(p_pay_to), ''), v_user, now(), now()
  );
  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_pv_id, v_ic_paying, v_pv_narr, p_amount, 0, 1, now()),
    (gen_random_uuid(), v_pv_id, v_credit.id, v_pv_narr, 0, p_amount, 2, now());

  -- Journal voucher in the other company's books, linked to the PV so it
  -- follows the PV through edits and deletion.
  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, is_auto,
    linked_voucher_id, pay_to, created_by, created_at, updated_at
  ) VALUES (
    v_jv_id, v_jv_no, v_jv_type_id, p_voucher_date, v_pv_no,
    v_jv_narr, p_amount, p_behalf_company_id, 'AUTHORISED', true,
    v_pv_id, nullif(btrim(p_pay_to), ''), v_user, now(), now()
  );
  INSERT INTO public.voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at
  ) VALUES
    (gen_random_uuid(), v_jv_id, v_expense.id, v_jv_narr, p_amount, 0, 1, now()),
    (gen_random_uuid(), v_jv_id, v_ic_behalf,  v_jv_narr, 0, p_amount, 2, now());

  RETURN jsonb_build_object(
    'paymentVoucherId',     v_pv_id,
    'paymentVoucherNumber', v_pv_no,
    'journalVoucherId',     v_jv_id,
    'journalVoucherNumber', v_jv_no
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_on_behalf_payment(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_on_behalf_payment(UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 4. Keep the linked JV in step when the PV is altered.
--    Amount, date, narration and cancellation all mirror; the JV's expense
--    ledger stays whatever it was set to (alter the JV itself to change it).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_on_behalf_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_jv RECORD;
BEGIN
  SELECT id INTO v_jv FROM public.vouchers WHERE linked_voucher_id = NEW.id LIMIT 1;
  IF v_jv.id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.vouchers
     SET voucher_date = NEW.voucher_date,
         total_amount = NEW.total_amount,
         status       = CASE WHEN NEW.status = 'CANCELLED' THEN 'CANCELLED' ELSE status END,
         pay_to       = NEW.pay_to,
         updated_at   = now()
   WHERE id = v_jv.id;

  UPDATE public.voucher_entries
     SET debit_amount = NEW.total_amount
   WHERE voucher_id = v_jv.id AND debit_amount > 0;
  UPDATE public.voucher_entries
     SET credit_amount = NEW.total_amount
   WHERE voucher_id = v_jv.id AND credit_amount > 0;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_on_behalf_journal ON public.vouchers;
CREATE TRIGGER trg_sync_on_behalf_journal
  AFTER UPDATE OF total_amount, voucher_date, status, pay_to ON public.vouchers
  FOR EACH ROW
  WHEN (OLD.total_amount IS DISTINCT FROM NEW.total_amount
     OR OLD.voucher_date IS DISTINCT FROM NEW.voucher_date
     OR OLD.status       IS DISTINCT FROM NEW.status
     OR OLD.pay_to       IS DISTINCT FROM NEW.pay_to)
  EXECUTE FUNCTION public.sync_on_behalf_journal();

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 5. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'vouchers'
     AND column_name IN ('on_behalf_of_company_id', 'linked_voucher_id', 'pay_to');
  IF v_cols <> 3 THEN
    RAISE EXCEPTION 'vouchers is missing on-behalf columns (found % of 3)', v_cols;
  END IF;

  -- The same-company guard must be the first thing a bad call hits.
  BEGIN
    PERFORM public.create_on_behalf_payment(
      '00000000-0000-0000-0000-000000000001'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      NULL, NULL, 100, current_date, NULL, NULL, 'verify');
    RAISE EXCEPTION 'verification did not reach the expected guard';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE '%two different companies%' THEN
        RAISE EXCEPTION 'unexpected guard: %', SQLERRM;
      END IF;
      RAISE NOTICE 'OK — create_on_behalf_payment guards hold: %', SQLERRM;
  END;
END;
$verify$;

COMMIT;
