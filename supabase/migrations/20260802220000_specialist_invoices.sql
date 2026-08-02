-- System-generated invoices for the people who never hand one in.
--
-- Surgeons, anesthetists and outsourced OT / cath-lab assistants are paid
-- per day or per case and give the hospital no invoice — but every payment
-- must map to one. So the system raises the invoice on their behalf: every
-- approval-queue bill now carries an invoice number, assigned by the
-- database on insert (and backfilled), so the payment screen can search a
-- party's unpaid invoices and pay several with one voucher.
--
-- The OT schedule also learns who assisted: outsourced OT / cath-lab
-- assistants with their case fee, entered the day before the procedure so
-- the bill can be approved before anyone operates.

ALTER TABLE public.approval_queue
  ADD COLUMN IF NOT EXISTS invoice_no TEXT;

CREATE SEQUENCE IF NOT EXISTS public.approval_invoice_seq;

CREATE OR REPLACE FUNCTION public.assign_approval_invoice_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.invoice_no IS NULL THEN
    NEW.invoice_no :=
      'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM') ||
      '-' || lpad(nextval('public.approval_invoice_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_approval_invoice_no ON public.approval_queue;
CREATE TRIGGER trg_assign_approval_invoice_no
  BEFORE INSERT ON public.approval_queue
  FOR EACH ROW EXECUTE FUNCTION public.assign_approval_invoice_no();

-- Existing bills get their numbers too, oldest first so the sequence reads
-- roughly chronologically.
UPDATE public.approval_queue
   SET invoice_no =
     'INV-' || to_char(COALESCE(created_at, now()), 'YYMM') ||
     '-' || lpad(nextval('public.approval_invoice_seq')::text, 5, '0')
 WHERE invoice_no IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS approval_queue_invoice_no_uniq
  ON public.approval_queue (invoice_no)
  WHERE invoice_no IS NOT NULL;

ALTER TABLE public.ot_schedule
  ADD COLUMN IF NOT EXISTS ot_assistant_name TEXT,
  ADD COLUMN IF NOT EXISTS ot_assistant_fee NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cathlab_assistant_name TEXT,
  ADD COLUMN IF NOT EXISTS cathlab_assistant_fee NUMERIC(12,2);

NOTIFY pgrst, 'reload schema';
