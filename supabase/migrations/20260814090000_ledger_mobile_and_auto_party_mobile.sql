-- Give every party a mobile number, before making one compulsory.
--
-- Hand-typed payments and receipts already cannot be saved without one
-- (require_voucher_party_mobile, 20260813240000). Automatic postings were
-- deliberately exempted, because a blanket rule would have stopped the
-- hospital taking money: there was nowhere to read a number from.
--
-- That is the gap this closes. chart_of_accounts -- the ledger master every
-- payment and receipt posts against -- has no mobile column at all, so a
-- staff or expense payment has no number anywhere in the system to fetch.
--
-- This script is step one of two, and enforces NOTHING. It adds the column,
-- fills it where the answer is already known, and stamps the number onto
-- automatic postings that would otherwise carry none. Step two makes it
-- compulsory, and must not run until coverage is good enough that it will not
-- block the counter.

-- apply_migration() runs this whole file in one transaction of its own, so
-- an explicit BEGIN/COMMIT here is both redundant and rejected.

-- 1. The column, same ten-digit shape the voucher rule uses. -----------------
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS mobile TEXT;

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_mobile_format_ck;
ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_mobile_format_ck
  CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$');

COMMENT ON COLUMN public.chart_of_accounts.mobile IS
  'Ten digits, of the party this ledger represents. Stamped onto automatic '
  'PAYMENT and RECEIPT vouchers that carry no number of their own.';

-- 2. One normaliser, matching the voucher trigger exactly. -------------------
-- Free-typed numbers arrive as "+91 98765 43210", "098765 43210", with dashes.
-- Anything that is not a real ten-digit Indian mobile becomes NULL rather than
-- being forced through: a wrong number is worse than no number.
CREATE OR REPLACE FUNCTION public.norm_party_mobile(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v TEXT;
BEGIN
  v := regexp_replace(COALESCE(p_value, ''), '[^0-9]', '', 'g');
  IF length(v) = 12 AND left(v, 2) = '91' THEN v := right(v, 10); END IF;
  IF length(v) = 11 AND left(v, 1) = '0'  THEN v := right(v, 10); END IF;
  IF v ~ '^[6-9][0-9]{9}$' THEN RETURN v; END IF;
  RETURN NULL;
END $$;

-- 3. Backfill supplier ledgers. ----------------------------------------------
-- suppliers.ledger_account_id points straight at the ledger, so this needs no
-- name matching -- which matters, because ledger names here differ by
-- punctuation and a fuzzy match would attach a number to the wrong party.
UPDATE public.chart_of_accounts coa
   SET mobile = COALESCE(
         public.norm_party_mobile(s.mobile),
         public.norm_party_mobile(s.phone)
       )
  FROM public.suppliers s
 WHERE s.ledger_account_id = coa.id
   AND coa.mobile IS NULL
   AND COALESCE(
         public.norm_party_mobile(s.mobile),
         public.norm_party_mobile(s.phone)
       ) IS NOT NULL;

-- 4. Stamp automatic postings from the ledger they touch. --------------------
-- Deliberately hung off voucher_entries rather than vouchers: the ledger is
-- only known once the lines are inserted, which happens after the voucher row.
-- Sixty migrations post vouchers; changing each of them would be sixty chances
-- to get it wrong, so the resolution lives in one place instead.
--
-- Only fills a NULL, so a number supplied by the posting code always wins, and
-- a hand-typed voucher (which cannot be NULL by now) is never touched.
CREATE OR REPLACE FUNCTION public.fill_voucher_party_mobile_from_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_category TEXT; v_mobile TEXT;
BEGIN
  IF NEW.account_id IS NULL THEN RETURN NEW; END IF;

  SELECT vt.voucher_category INTO v_category
    FROM vouchers v
    JOIN voucher_types vt ON vt.id = v.voucher_type_id
   WHERE v.id = NEW.voucher_id
     AND v.party_mobile IS NULL;

  IF v_category IS NULL OR v_category NOT IN ('PAYMENT', 'RECEIPT') THEN
    RETURN NEW;
  END IF;

  SELECT public.norm_party_mobile(coa.mobile) INTO v_mobile
    FROM chart_of_accounts coa WHERE coa.id = NEW.account_id;

  IF v_mobile IS NOT NULL THEN
    UPDATE vouchers SET party_mobile = v_mobile
     WHERE id = NEW.voucher_id AND party_mobile IS NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fill_voucher_party_mobile ON public.voucher_entries;
CREATE TRIGGER trg_fill_voucher_party_mobile
  AFTER INSERT ON public.voucher_entries
  FOR EACH ROW EXECUTE FUNCTION public.fill_voucher_party_mobile_from_ledger();

-- 5. Prove it, and refuse to commit if any of it is wrong. -------------------
DO $verify$
DECLARE
  v_pay UUID; v_ledger UUID; v_voucher UUID; v_stored TEXT; v_filled INT;
BEGIN
  -- (a) the normaliser accepts the real shapes and rejects rubbish
  IF public.norm_party_mobile('+91 98765 43210') <> '9876543210' THEN
    RAISE EXCEPTION 'ABORT: "+91 98765 43210" did not normalise';
  END IF;
  IF public.norm_party_mobile('098765-43210') <> '9876543210' THEN
    RAISE EXCEPTION 'ABORT: a leading 0 was not stripped';
  END IF;
  IF public.norm_party_mobile('12345') IS NOT NULL
     OR public.norm_party_mobile('1234567890') IS NOT NULL
     OR public.norm_party_mobile(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: a bad number was accepted';
  END IF;

  -- (b) an automatic payment against a ledger WITH a number gets stamped
  SELECT id INTO v_pay FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active LIMIT 1;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'ABORT: no active PAYMENT voucher type'; END IF;

  -- Borrow a ledger that has NO number, so restoring it to NULL afterwards is
  -- correct. Taking any ledger would destroy a number the backfill above had
  -- just written into it.
  SELECT id INTO v_ledger FROM chart_of_accounts WHERE mobile IS NULL LIMIT 1;
  IF v_ledger IS NULL THEN RAISE EXCEPTION 'ABORT: no numberless ledger to self-test with'; END IF;

  UPDATE chart_of_accounts SET mobile = '9876543210' WHERE id = v_ledger;

  INSERT INTO vouchers (id, voucher_number, voucher_type_id, voucher_date, total_amount, is_auto, status)
  VALUES (gen_random_uuid(), 'SELFTEST-MOB', v_pay, CURRENT_DATE, 1, true, 'PENDING')
  RETURNING id INTO v_voucher;

  INSERT INTO voucher_entries (id, voucher_id, account_id, debit_amount, credit_amount, entry_order)
  VALUES (gen_random_uuid(), v_voucher, v_ledger, 1, 0, 1);

  SELECT party_mobile INTO v_stored FROM vouchers WHERE id = v_voucher;
  IF v_stored <> '9876543210' THEN
    RAISE EXCEPTION 'ABORT: an automatic payment was not stamped (got %)', COALESCE(v_stored, 'NULL');
  END IF;

  -- Clean up the self-test completely, including the ledger we borrowed.
  DELETE FROM voucher_entries WHERE voucher_id = v_voucher;
  DELETE FROM vouchers WHERE id = v_voucher;
  UPDATE chart_of_accounts SET mobile = NULL WHERE id = v_ledger;

  IF EXISTS (SELECT 1 FROM vouchers WHERE voucher_number = 'SELFTEST-MOB') THEN
    RAISE EXCEPTION 'ABORT: the self-test voucher was left behind';
  END IF;

  -- (c) report the coverage this bought, for the step-two decision
  SELECT count(*) INTO v_filled FROM chart_of_accounts WHERE mobile IS NOT NULL;
  RAISE NOTICE 'Ledgers now carrying a mobile: %', v_filled;
END
$verify$;


NOTIFY pgrst, 'reload schema';
