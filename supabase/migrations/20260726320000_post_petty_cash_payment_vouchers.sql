-- Post the payment vouchers staff already write, so cash paid out reaches the
-- ledger.
--
-- /payment-voucher is already a proper Tally-style entry screen: an Account
-- ledger the money leaves from, and one or more Particulars lines saying what
-- it was spent on. Staff enter the debits and credits correctly today. The
-- entry simply stops at payment_vouchers - nothing posts, so every rupee of
-- petty cash sits outside the books. The only trigger on that table numbers
-- the voucher.
--
--     Dr  each particulars line     its own amount
--         Cr  the Account ledger        the total
--
-- So this is not new bookkeeping. It is carrying an entry that already exists
-- across into the accounts.
--
-- WHY THE TRIGGER IS ON THE LINES, NOT THE VOUCHER. PaymentVoucher.tsx:596-621
-- inserts the header first and the lines second, in two statements. A trigger
-- on payment_vouchers would fire while the voucher still had no particulars and
-- would post a one-legged entry. The lines arrive in a single multi-row insert,
-- so this is a statement-level trigger reading the transition table - the same
-- shape as the corporate bulk payment allocations.
--
-- LEDGER NAMES. The picker chooses from tally_ledgers, which are Tally's
-- masters, not Adamrit's chart of accounts. Almost all of them share a name
-- with an Adamrit ledger, so matching by name resolves nearly everything.
-- What does not match posts to Petty Cash Expenses and is reported, rather than
-- a ledger being invented from a free-text field.

-- ------------------------------------------------------------------
-- Accounts the posting needs, created only if missing.
-- ------------------------------------------------------------------
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group,
   opening_balance, opening_balance_type, is_active)
VALUES
  ('5900', 'Petty Cash Expenses', 'INDIRECT_EXPENSES', 'Indirect Expenses', 0, 'DR', true),
  ('1110', 'Cash in Hand',        'CURRENT_ASSETS',    'Cash-in-Hand',      0, 'DR', true)
ON CONFLICT (account_code) DO NOTHING;

-- ------------------------------------------------------------------
-- Which Adamrit ledger a Tally ledger name refers to. Exact name first, then
-- the same name ignoring case and spacing, then the caller's fallback.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adamrit_ledger_by_name(
  p_name          TEXT,
  p_fallback_code TEXT
) RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NOT NULL THEN
    SELECT a.id INTO v_id
      FROM chart_of_accounts a
     WHERE a.is_active = true
       AND lower(btrim(a.account_name)) = lower(btrim(p_name))
     ORDER BY a.account_code
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id FROM chart_of_accounts WHERE account_code = p_fallback_code;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------
-- The posting itself, once per voucher whose lines have just landed.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_payment_voucher_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pv         RECORD;
  v_credit_id  UUID;
  v_company_id UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
  v_total      NUMERIC(15,2);
BEGIN
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE WARNING 'Payment vouchers: no PAYMENT voucher type, nothing posted';
    RETURN NULL;
  END IF;

  FOR v_pv IN
    SELECT pv.*
      FROM payment_vouchers pv
     WHERE pv.id IN (SELECT DISTINCT voucher_id FROM new_lines)
  LOOP
    v_reference := 'PV-' || v_pv.id::TEXT;

    CONTINUE WHEN EXISTS (SELECT 1 FROM vouchers
                           WHERE reference_number = v_reference AND status <> 'CANCELLED');

    -- Where the money left from. Petty cash unless the Account ledger names
    -- something else that exists in the chart of accounts.
    v_credit_id := public.adamrit_ledger_by_name(v_pv.account_ledger_name, '1110');

    -- hospital_type is the same 'ayushman' / anything-else distinction the
    -- patient ledgers use, so the same resolver decides the company.
    v_company_id := public.resolve_patient_company(v_pv.hospital_type, NULL);

    v_narration := 'Payment voucher ' || COALESCE(v_pv.voucher_no, v_reference)
                   || COALESCE(' - ' || NULLIF(btrim(v_pv.narration), ''),
                        COALESCE(' - ' || NULLIF(btrim(v_pv.purpose), ''), ''));

    v_voucher_id := gen_random_uuid();
    v_voucher_no := generate_voucher_number(v_type_code);

    INSERT INTO vouchers (
      id, voucher_number, voucher_type_id, voucher_date, reference_number,
      narration, total_amount, company_id, status, created_by, created_at, updated_at
    ) VALUES (
      v_voucher_id, v_voucher_no, v_type_id,
      COALESCE(v_pv.voucher_date, CURRENT_DATE),
      v_reference, v_narration, 0, v_company_id, 'AUTHORISED',
      COALESCE(NULLIF(btrim(v_pv.paid_by), ''), 'payment-voucher'), NOW(), NOW()
    );

    -- One debit per particulars line, and the credit derived from what was
    -- actually posted rather than from the header total, so a header that
    -- disagrees with its own lines cannot unbalance the voucher.
    WITH posted AS (
      INSERT INTO voucher_entries (
        id, voucher_id, account_id, narration, debit_amount, credit_amount,
        entry_order, created_at
      )
      SELECT gen_random_uuid(), v_voucher_id,
             public.adamrit_ledger_by_name(l.ledger_name, '5900'),
             COALESCE(NULLIF(btrim(l.ledger_name), ''), 'Petty cash') || ' - ' || v_narration,
             ROUND(COALESCE(l.amount, 0), 2), 0,
             COALESCE(l.line_order, 0) + 1, NOW()
        FROM payment_voucher_lines l
       WHERE l.voucher_id = v_pv.id
         AND COALESCE(l.amount, 0) > 0
      RETURNING debit_amount
    )
    SELECT COALESCE(SUM(debit_amount), 0) INTO v_total FROM posted;

    IF v_total <= 0 THEN
      DELETE FROM vouchers WHERE id = v_voucher_id;
      CONTINUE;
    END IF;

    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount,
      entry_order, created_at
    ) VALUES (
      gen_random_uuid(), v_voucher_id, v_credit_id,
      'Paid from ' || COALESCE(NULLIF(btrim(v_pv.account_ledger_name), ''), 'Cash in Hand')
      || ' - ' || v_narration,
      0, v_total, 9999, NOW()
    );

    UPDATE vouchers SET total_amount = v_total WHERE id = v_voucher_id;

    RAISE NOTICE 'Payment voucher %: posted Rs %', v_pv.voucher_no, v_total;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_payment_voucher_lines ON public.payment_voucher_lines;
CREATE TRIGGER trg_post_payment_voucher_lines
AFTER INSERT ON public.payment_voucher_lines
REFERENCING NEW TABLE AS new_lines
FOR EACH STATEMENT
EXECUTE FUNCTION public.post_payment_voucher_lines();

-- ------------------------------------------------------------------
-- Deleting a voucher retires its posting. The page offers a delete
-- (PaymentVoucher.tsx:643), and lines cascade away with the header, so the
-- accounting entry has to go the same way or the books would keep a payment
-- that no longer exists.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_payment_voucher_posting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE vouchers
     SET status = 'CANCELLED',
         last_modified_by = 'payment-voucher-deleted',
         updated_at = now()
   WHERE reference_number = 'PV-' || OLD.id::TEXT
     AND status <> 'CANCELLED';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_payment_voucher_posting ON public.payment_vouchers;
CREATE TRIGGER trg_cancel_payment_voucher_posting
AFTER DELETE ON public.payment_vouchers
FOR EACH ROW
EXECUTE FUNCTION public.cancel_payment_voucher_posting();
