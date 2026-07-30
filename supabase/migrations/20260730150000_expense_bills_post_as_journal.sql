-- Expense bills post a Journal, not a Purchase.
--
-- An expense bill is an accrual: Dr the expense head, Cr the party. That is a
-- journal entry. Purchase (F9) is for buying goods and services against stock,
-- which the hospital does not track here. 20260726200000_enable_purchase_vouchers
-- argued the other way and this supersedes it: the approval-queue flow already
-- posts these as JOURNAL (src/lib/approval-queue-service.ts), so the same entry
-- was landing in two different registers depending on the screen it came from.
--
-- The PUR voucher type stays active. Nothing posts to it automatically any more,
-- but F9 Purchase in Voucher Entry still works for anyone raising one by hand.
--
-- Existing expense-bill vouchers are retyped and renumbered into the JV series,
-- so the Journal Register carries the whole history rather than a split of it.
-- Nothing outside vouchers/voucher_entries stores these numbers: expense_bills
-- keeps only bill_number, and payments match on voucher_entries.bill_ref.
--
-- Run this in the Supabase dashboard SQL Editor. Safe to run twice.

-- 1. Post new bills as a journal ----------------------------------------------
CREATE OR REPLACE FUNCTION public.post_expense_bill()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
BEGIN
  v_reference := COALESCE(NEW.id, OLD.id)::TEXT;

  -- Cancelling the bill retires its entry. Soft cancel keeps the number and
  -- the audit trail, and the document stays attached.
  IF TG_OP = 'UPDATE' AND NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
    UPDATE vouchers
       SET status = 'CANCELLED', last_modified_by = 'expense-bill-cancelled', updated_at = now()
     WHERE reference_number = v_reference AND status <> 'CANCELLED';
    RETURN NEW;
  END IF;

  IF NEW.status <> 'POSTED' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  -- An accrual against a party: journal.
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE WARNING 'Expense bill %: no active JOURNAL voucher type', NEW.bill_number;
    RETURN NEW;
  END IF;

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);
  v_narration  := COALESCE(NULLIF(btrim(NEW.narration), ''),
                           'Invoice ' || NEW.bill_number);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id, NEW.bill_date, v_reference,
    v_narration, NEW.amount, NEW.company_id, 'AUTHORISED',
    COALESCE(NEW.created_by, 'expense-bill'), NOW(), NOW()
  );

  -- bill_ref on the party line only. That is the open item a payment will be
  -- matched against; the expense side is closed the moment it is posted.
  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, bill_ref, created_at
  ) VALUES
    (gen_random_uuid(), v_voucher_id, NEW.expense_ledger_id, v_narration,
     NEW.amount, 0, 1, NULL, NOW()),
    (gen_random_uuid(), v_voucher_id, NEW.party_ledger_id, v_narration,
     0, NEW.amount, 2, NEW.bill_number, NOW());

  RAISE NOTICE 'Expense bill %: posted % as %', NEW.bill_number, NEW.amount, v_voucher_no;
  RETURN NEW;
END;
$$;

-- 2. Retype and renumber the bills already posted ------------------------------
-- Identified by provenance (reference_number is the expense_bills row id), not
-- by the PUR- prefix, so a hand-entered purchase is left alone.
DO $$
DECLARE
  r      RECORD;
  v_jv   UUID;
  v_no   TEXT;
  v_done INTEGER := 0;
BEGIN
  SELECT id INTO v_jv
    FROM voucher_types
   WHERE voucher_category = 'JOURNAL' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'JV' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_jv IS NULL THEN
    RAISE EXCEPTION 'No active JOURNAL voucher type is configured';
  END IF;

  FOR r IN
    SELECT v.id, v.voucher_number
      FROM vouchers v
      JOIN voucher_types t ON t.id = v.voucher_type_id
      JOIN expense_bills b ON b.id::TEXT = v.reference_number
     WHERE t.voucher_category = 'PURCHASE'
     ORDER BY v.voucher_date, v.created_at   -- keep the JV series chronological
  LOOP
    -- generate_voucher_number self-heals past any JV number already issued.
    v_no := generate_voucher_number('JV');

    UPDATE vouchers
       SET voucher_type_id  = v_jv,
           voucher_number   = v_no,
           last_modified_by = 'expense-bill-journal-retype',
           updated_at       = now()
     WHERE id = r.id;

    v_done := v_done + 1;
    RAISE NOTICE 'Retyped % -> %', r.voucher_number, v_no;
  END LOOP;

  RAISE NOTICE '% expense-bill voucher(s) moved from Purchase to Journal', v_done;
END $$;

-- 3. What is left in the Purchase register -------------------------------------
-- Expect nothing, or only vouchers someone raised by hand through F9.
SELECT v.voucher_number, v.voucher_date, v.total_amount, v.narration, v.created_by
  FROM public.vouchers v
  JOIN public.voucher_types t ON t.id = v.voucher_type_id
 WHERE t.voucher_category = 'PURCHASE'
 ORDER BY v.voucher_date DESC;
