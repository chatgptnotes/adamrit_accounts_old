-- Keep a bridged medicine's dispense state in sync between the tablet
-- (visit_medications) and the desktop pharmacy (prescription_items), so the
-- same medicine can never be dispensed twice. Triggers run as table owner and
-- bypass RLS. Loop-safe: each direction's guard makes the other a no-op once
-- both sides agree (see WHEN clauses + the IS DISTINCT FROM / "<" guards).
--
-- Note: a desktop dispense additionally creates a pharmacy_sale + decrements
-- stock (the pharmacist's counter sale); a tablet dispense is ward administration
-- and only marks status — no counter sale. That asymmetry is intended.

-- Direction A: desktop fully dispenses a prescription_item -> mark the linked
-- visit_medications row dispensed.
CREATE OR REPLACE FUNCTION public.sync_prescription_dispense_to_vm()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.quantity_dispensed, 0) >= COALESCE(NEW.quantity_prescribed, 0) THEN
    UPDATE public.visit_medications
       SET status = 'dispensed',
           dispensed_at = COALESCE(dispensed_at, now()),
           dispensed_medication_name = COALESCE(dispensed_medication_name, NEW.medicine_name)
     WHERE id = NEW.visit_medication_id
       AND status IS DISTINCT FROM 'dispensed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_prescription_dispense_to_vm ON public.prescription_items;
CREATE TRIGGER trg_sync_prescription_dispense_to_vm
  AFTER UPDATE ON public.prescription_items
  FOR EACH ROW
  WHEN (NEW.visit_medication_id IS NOT NULL
        AND NEW.quantity_dispensed IS DISTINCT FROM OLD.quantity_dispensed)
  EXECUTE FUNCTION public.sync_prescription_dispense_to_vm();

-- Direction B: tablet dispenses a visit_medications row -> mark the linked
-- prescription_item fully dispensed and roll the parent prescription status up.
CREATE OR REPLACE FUNCTION public.sync_vm_dispense_to_prescription()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rx_id uuid;
  remaining int;
  new_status text;
BEGIN
  UPDATE public.prescription_items
     SET quantity_dispensed = quantity_prescribed, dispensed_at = now()
   WHERE visit_medication_id = NEW.id
     AND COALESCE(quantity_dispensed, 0) < COALESCE(quantity_prescribed, 0);

  FOR rx_id IN
    SELECT DISTINCT prescription_id FROM public.prescription_items
     WHERE visit_medication_id = NEW.id
  LOOP
    SELECT count(*) INTO remaining
      FROM public.prescription_items
     WHERE prescription_id = rx_id
       AND COALESCE(quantity_dispensed, 0) < COALESCE(quantity_prescribed, 0);
    new_status := CASE WHEN remaining = 0 THEN 'DISPENSED' ELSE 'PARTIALLY_DISPENSED' END;
    UPDATE public.prescriptions
       SET status = new_status, updated_at = now()
     WHERE id = rx_id AND status IS DISTINCT FROM new_status;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_vm_dispense_to_prescription ON public.visit_medications;
CREATE TRIGGER trg_sync_vm_dispense_to_prescription
  AFTER UPDATE ON public.visit_medications
  FOR EACH ROW
  WHEN (NEW.status = 'dispensed' AND OLD.status IS DISTINCT FROM 'dispensed')
  EXECUTE FUNCTION public.sync_vm_dispense_to_prescription();
