-- Tilak's number for the unbilled-payment alerts.
--
-- Seeded as a placeholder in 20260808070000 because the number was not known
-- then. Set and made active here, in the same +91 form DoubleTick is given
-- for Dr Murali's number.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

UPDATE public.recon_alert_recipients
   SET label = 'Tilak',
       phone = '+919518945703',
       is_active = true
 WHERE label LIKE 'Tilak%';

INSERT INTO public.recon_alert_recipients (label, phone, is_active)
SELECT 'Tilak', '+919518945703', true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.recon_alert_recipients WHERE phone = '+919518945703'
 );

DO $$
DECLARE r RECORD; v_list TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.recon_alert_recipients
     WHERE phone = '+919518945703' AND is_active
  ) THEN
    RAISE EXCEPTION 'ABORT: Tilak is not an active recipient';
  END IF;

  IF EXISTS (SELECT 1 FROM public.recon_alert_recipients WHERE phone = 'TILAK-NUMBER-PENDING') THEN
    RAISE EXCEPTION 'ABORT: the placeholder row is still there';
  END IF;

  FOR r IN SELECT label, phone FROM public.recon_alert_recipients WHERE is_active ORDER BY label
  LOOP
    v_list := v_list || r.label || ' ' || r.phone || '; ';
  END LOOP;
  RAISE NOTICE 'OK — alerts go to: %', v_list;
END $$;
