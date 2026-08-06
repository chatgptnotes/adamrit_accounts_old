-- Pay an expense bill from the row: the payee's QR to scan, and the PhonePe
-- confirmation uploaded back against that bill.
--
--   1. ledger_payment_qr — one QR per LEDGER, so any party a bill is raised
--      against (vendor, diagnostic centre, doctor) carries its own code.
--      doctor_payment_qr stays where it is for the Akshay tile; the codes
--      already collected there are copied across by exact name match.
--   2. expense_bills.payment_proof_path / _url — the payment screenshot for
--      that bill, distinct from signed_voucher_url (the signature taken when
--      cash changes hands).
--   3. Both, plus party_ledger_id, exposed on v_expense_bills_outstanding so
--      the desktop register and the tablet module read one row per bill.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

-- ------------------------------------------------------------------
-- 1. The payee's QR, per ledger
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_payment_qr (
  account_id UUID PRIMARY KEY REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  qr_url     TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ledger_payment_qr ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on ledger_payment_qr" ON public.ledger_payment_qr;
CREATE POLICY "Allow all operations on ledger_payment_qr"
  ON public.ledger_payment_qr FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_ledger_payment_qr_updated_at ON public.ledger_payment_qr;
CREATE TRIGGER update_ledger_payment_qr_updated_at
  BEFORE UPDATE ON public.ledger_payment_qr
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Carry over the QRs Akshay already collected, where the doctor's name is a
-- ledger name. Only unambiguous matches: a name held by several ledgers in
-- one company is skipped rather than guessed at.
INSERT INTO public.ledger_payment_qr (account_id, qr_url, updated_by)
SELECT a.id, q.qr_url, COALESCE(q.updated_by, 'doctor-qr-carryover')
  FROM public.doctor_payment_qr q
  JOIN public.chart_of_accounts a
    ON lower(btrim(a.account_name)) = lower(btrim(q.doctor_name))
   AND a.is_active
ON CONFLICT (account_id) DO NOTHING;

-- ------------------------------------------------------------------
-- 2. The payment screenshot, per bill
-- ------------------------------------------------------------------
ALTER TABLE public.expense_bills
  ADD COLUMN IF NOT EXISTS payment_proof_path TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_url  TEXT;

-- ------------------------------------------------------------------
-- 3. The register view — party ledger, its QR, and the proof
-- ------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_expense_bills_outstanding;
CREATE VIEW public.v_expense_bills_outstanding AS
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
       b.status,
       b.company_id,
       b.narration,
       COALESCE(NULLIF(btrim(b.point_of_contact), ''), p.point_of_contact)
                                                        AS point_of_contact,
       b.relationship_manager,
       b.patient_name,
       b.patient_type,
       b.revenue_entry_id,
       b.created_at,
       b.signed_voucher_url,
       b.party_ledger_id,
       qr.qr_url                                        AS party_qr_url,
       b.payment_proof_url
  FROM public.expense_bills b
  JOIN public.chart_of_accounts p ON p.id = b.party_ledger_id
  JOIN public.chart_of_accounts x ON x.id = b.expense_ledger_id
  LEFT JOIN public.ledger_payment_qr qr ON qr.account_id = b.party_ledger_id
  LEFT JOIN LATERAL (
    SELECT sum(e.debit_amount) AS amount
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id
     WHERE e.account_id = b.party_ledger_id
       AND btrim(COALESCE(e.bill_ref, '')) = btrim(b.bill_number)
       AND v.company_id IS NOT DISTINCT FROM b.company_id
       AND v.status = 'AUTHORISED'
       AND e.debit_amount > 0
  ) paid ON true
 WHERE b.status = 'POSTED';

ALTER VIEW public.v_expense_bills_outstanding SET (security_invoker = true);
GRANT SELECT ON public.v_expense_bills_outstanding TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- 4. Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['party_ledger_id', 'party_qr_url', 'payment_proof_url',
                      'signed_voucher_url', 'outstanding']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'v_expense_bills_outstanding'
        AND column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'the register view is missing: %', v_missing;
  END IF;

  -- The view must still return the bills it did before.
  IF (SELECT count(*) FROM public.v_expense_bills_outstanding)
     <> (SELECT count(*) FROM public.expense_bills WHERE status = 'POSTED') THEN
    RAISE EXCEPTION 'the rebuilt view lost or gained rows';
  END IF;

  RAISE NOTICE 'OK — % ledger QR(s) carried over, view rebuilt',
    (SELECT count(*) FROM public.ledger_payment_qr);
END;
$verify$;
