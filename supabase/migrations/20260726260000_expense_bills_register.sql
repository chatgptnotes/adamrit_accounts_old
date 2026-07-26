-- An expense bill register, so any incoming invoice accrues itself.
--
-- Electricity, rent, doctor payouts, salaries and one-off vendor invoices have
-- nowhere to be recorded today, so their expense only reaches the books when
-- someone pays. This is the capture point they were missing: one row per
-- invoice, with the approved document attached as evidence, and the journal
-- entry posted automatically.
--
--     Dr  <expense head>       the invoice amount
--         Cr  <the party>           same amount
--
-- Paying it later is an ordinary Payment voucher against the same party.
--
-- Linking payments back to the bill uses Tally's own mechanism rather than a
-- new allocation table: voucher_entries.bill_ref carries the invoice number on
-- both the accrual (New Ref) and the payment (Agst Ref), and the existing
-- BillwiseOutstanding screen nets them per party. That handles part payments
-- and one payment covering several bills, because it matches amounts against a
-- reference rather than forcing one payment to one bill.
--
-- The party is picked from the creditor ledgers already in the chart - 872 came
-- across from Tally - so the credit always lands on a real account and the
-- chart does not drift with spelling variants.

-- bill_ref is written by VoucherEntry.tsx but was added out of band, and that
-- screen still probes for it at runtime. Make sure it is really there.
ALTER TABLE public.voucher_entries
  ADD COLUMN IF NOT EXISTS bill_ref TEXT;

CREATE TABLE IF NOT EXISTS public.expense_bills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number       TEXT NOT NULL,
  bill_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,
  party_ledger_id   UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  expense_ledger_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  narration         TEXT,
  -- the approved invoice, held as evidence against the entry
  document_path     TEXT,
  document_url      TEXT,
  company_id        UUID REFERENCES public.companies(id),
  status            TEXT NOT NULL DEFAULT 'POSTED'
                    CHECK (status IN ('POSTED', 'CANCELLED')),
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.expense_bills IS
  'Incoming supplier, utility and other expense invoices. Each row posts its '
  'own journal entry; the payment is recorded separately and matched by bill_ref.';

CREATE INDEX IF NOT EXISTS idx_expense_bills_party   ON public.expense_bills(party_ledger_id);
CREATE INDEX IF NOT EXISTS idx_expense_bills_date    ON public.expense_bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_expense_bills_status  ON public.expense_bills(status);
CREATE INDEX IF NOT EXISTS idx_voucher_entries_bill_ref
  ON public.voucher_entries(bill_ref) WHERE bill_ref IS NOT NULL;

ALTER TABLE public.expense_bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_expense_bills" ON public.expense_bills;
CREATE POLICY "authenticated_all_expense_bills" ON public.expense_bills
  FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------
-- Post the entry when the bill is recorded, and retire it if cancelled.
-- ------------------------------------------------------------------
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

  -- A purchase for goods and services; falls back to a journal where no
  -- purchase type is configured.
  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category IN ('PURCHASE', 'JOURNAL') AND is_active = true
   ORDER BY CASE voucher_category WHEN 'PURCHASE' THEN 1 ELSE 2 END,
            CASE voucher_type_code WHEN 'PUR' THEN 1 WHEN 'JV' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE WARNING 'Expense bill %: no PURCHASE or JOURNAL voucher type', NEW.bill_number;
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

DROP TRIGGER IF EXISTS trg_post_expense_bill ON public.expense_bills;
CREATE TRIGGER trg_post_expense_bill
AFTER INSERT OR UPDATE OF status ON public.expense_bills
FOR EACH ROW
EXECUTE FUNCTION public.post_expense_bill();


-- What is outstanding per party, netting payments matched by bill_ref.
CREATE OR REPLACE VIEW public.v_expense_bills_outstanding AS
SELECT b.id,
       b.bill_number,
       b.bill_date,
       b.due_date,
       p.account_name                                   AS party,
       x.account_name                                   AS expense_head,
       b.amount                                         AS billed,
       COALESCE(paid.amount, 0)                         AS paid,
       b.amount - COALESCE(paid.amount, 0)              AS outstanding,
       b.document_url,
       b.status
  FROM public.expense_bills b
  JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
  JOIN public.chart_of_accounts x ON x.id = b.expense_ledger_id
  LEFT JOIN LATERAL (
    -- Anything debited to this party against the same reference is a payment
    -- of it. The accrual itself is a credit, so it never counts here.
    SELECT sum(e.debit_amount) AS amount
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id
     WHERE e.account_id = b.party_ledger_id
       AND btrim(COALESCE(e.bill_ref, '')) = btrim(b.bill_number)
       AND v.status = 'AUTHORISED'
       AND e.debit_amount > 0
  ) paid ON true
 WHERE b.status = 'POSTED';
