-- The accounts section hears about a new bill the moment it lands.
--
-- OT surgery invoices (surgeon / anesthetist / assistants), RMO duty bills
-- and hand-entered vendor bills all arrive as PENDING approval_queue rows,
-- but nothing told the accountant: the only feedback was an in-session toast
-- on the tablet that created them. Now every PENDING insert writes one
-- notifications row (recipient_role 'all' - the same shared-row convention
-- the pharmacy threshold alerts use), so the notification bell shows it.
-- The accounting sidebar separately badges the live PENDING count.
--
-- SECURITY DEFINER: notifications RLS only lets clients read and mark read;
-- inserts happen inside definer functions, this one included. A failure to
-- notify must never block the bill itself, hence the swallowed exception.

CREATE OR REPLACE FUNCTION public.notify_approval_pending()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'PENDING' THEN
    BEGIN
      INSERT INTO public.notifications (
        notification_type, title, message,
        recipient_user_id, recipient_role,
        source_table, source_id, payload
      ) VALUES (
        'approval_pending',
        'New bill awaiting approval',
        COALESCE(NEW.invoice_no || ' — ', '')
          || NEW.party_name
          || CASE WHEN COALESCE(NEW.amount, 0) > 0
                  THEN ' ₹' || to_char(NEW.amount, 'FM99,99,99,999')
                  ELSE '' END
          || COALESCE(': ' || NEW.narration, ''),
        NULL,
        'all',
        'approval_queue',
        NEW.id::TEXT,
        jsonb_build_object(
          'category', NEW.category,
          'party_name', NEW.party_name,
          'amount', NEW.amount,
          'invoice_no', NEW.invoice_no,
          'ot_schedule_id', NEW.ot_schedule_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'approval notification failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_approval_pending ON public.approval_queue;
CREATE TRIGGER trg_notify_approval_pending
AFTER INSERT ON public.approval_queue
FOR EACH ROW
EXECUTE FUNCTION public.notify_approval_pending();
