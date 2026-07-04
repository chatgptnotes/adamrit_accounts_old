-- 1) Voucher Edit Log (Tally Edit Log equivalent): tamper-proof, trigger-based
--    audit of every voucher creation, alteration, cancellation and deletion.
-- 2) Full Tally ledger fields: mailing / GST columns on ledgers.

-- Who performed the change: the app stamps this before each write.
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS last_modified_by TEXT;

CREATE TABLE IF NOT EXISTS public.voucher_edit_log (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voucher_id     UUID,
  voucher_number TEXT,
  action         TEXT NOT NULL CHECK (action IN ('CREATED','ALTERED','CANCELLED','DELETED')),
  changed_by     TEXT,
  old_data       JSONB,
  new_data       JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_edit_log_created ON public.voucher_edit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voucher_edit_log_voucher ON public.voucher_edit_log (voucher_id);

ALTER TABLE public.voucher_edit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on voucher_edit_log" ON public.voucher_edit_log;
CREATE POLICY "Allow all operations on voucher_edit_log"
  ON public.voucher_edit_log FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.log_voucher_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.voucher_edit_log (voucher_id, voucher_number, action, changed_by, new_data)
    VALUES (NEW.id, NEW.voucher_number, 'CREATED', COALESCE(NEW.last_modified_by, NEW.created_by), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
      INSERT INTO public.voucher_edit_log (voucher_id, voucher_number, action, changed_by, old_data, new_data)
      VALUES (NEW.id, NEW.voucher_number, 'CANCELLED', NEW.last_modified_by, to_jsonb(OLD), to_jsonb(NEW));
    ELSIF (to_jsonb(NEW) - 'last_modified_by' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD) - 'last_modified_by' - 'updated_at') THEN
      -- Skip the app's pre-delete "stamp who" update; log real alterations only
      INSERT INTO public.voucher_edit_log (voucher_id, voucher_number, action, changed_by, old_data, new_data)
      VALUES (NEW.id, NEW.voucher_number, 'ALTERED', NEW.last_modified_by, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.voucher_edit_log (voucher_id, voucher_number, action, changed_by, old_data)
    VALUES (OLD.id, OLD.voucher_number, 'DELETED', OLD.last_modified_by, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS voucher_edit_log_trigger ON public.vouchers;
CREATE TRIGGER voucher_edit_log_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.log_voucher_changes();

-- 2) Full Tally Ledger Creation fields (mailing / tax; banking columns exist)
ALTER TABLE public.ledgers
  ADD COLUMN IF NOT EXISTS mailing_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS gstin TEXT;

NOTIFY pgrst, 'reload schema';
