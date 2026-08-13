-- Tell the people who have to act.
--
-- Two real handovers sat at SUBMITTED all evening because nothing told Avni
-- they were waiting for her. The chain only works if the next person knows
-- their turn has come.
--
-- Web Push is not the way: push_subscriptions holds no rows and its send
-- trigger is still unapplied, waiting on pg_net. The in-app notifications
-- table is proven here -- approval_queue and the pharmacy threshold alerts
-- both use it and the bell already listens for inserts in real time.
--
-- Targeted, not broadcast: the receiver is asked to acknowledge, the nominated
-- verifiers are asked to verify, and nobody else is troubled. A failure to
-- notify must never block a handover, so every insert is wrapped and swallowed
-- -- the same rule the approval notifier follows.

CREATE OR REPLACE FUNCTION public.notify_cash_handover()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount TEXT;
  v_where TEXT;
  v_verifier RECORD;
BEGIN
  v_amount := '₹' || to_char(NEW.counted_cash, 'FM99,99,99,990');
  v_where := CASE lower(COALESCE(NEW.hospital_type, ''))
               WHEN 'pharmacy' THEN 'Hope Pharmacy'
               WHEN 'ayushman' THEN 'Ayushman Nagpur'
               WHEN 'hope'     THEN 'Hope Hospital'
               ELSE 'the counter'
             END;

  -- Handed over: the named receiver is the one who must acknowledge it.
  IF TG_OP = 'INSERT' AND NEW.status = 'SUBMITTED' THEN
    BEGIN
      INSERT INTO public.notifications (
        notification_type, title, message, recipient_user_id, recipient_role,
        source_table, source_id, payload
      ) VALUES (
        'cash_handover_pending',
        'Cash handed to you — please acknowledge',
        NEW.from_user_name || ' handed you ' || v_amount || ' at ' || v_where
          || ' (' || NEW.handover_no || '). Count it and confirm you have received it.',
        NEW.to_user_id, NULL,
        'cash_handovers', NEW.id::TEXT,
        jsonb_build_object('handoverNo', NEW.handover_no, 'amount', NEW.counted_cash,
                           'from', NEW.from_user_name, 'action', 'accept')
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Accepted: now the independent check is owed. Every nominated verifier for
  -- that counter is told, except the person who handed it over -- they may not
  -- verify their own count, so asking them would be noise.
  IF TG_OP = 'UPDATE' AND NEW.status = 'ACCEPTED' AND OLD.status <> 'ACCEPTED' THEN
    FOR v_verifier IN
      SELECT v.user_id, v.display_name
        FROM cash_handover_verifiers v
       WHERE v.is_active AND v.can_verify
         AND v.user_id <> NEW.from_user_id
         AND (v.hospital_type = '*'
              OR lower(btrim(v.hospital_type)) = lower(btrim(COALESCE(NEW.hospital_type, ''))))
    LOOP
      BEGIN
        INSERT INTO public.notifications (
          notification_type, title, message, recipient_user_id, recipient_role,
          source_table, source_id, payload
        ) VALUES (
          'cash_handover_verify',
          'A cash count needs verifying',
          NEW.to_user_name || ' has taken ' || v_amount || ' from ' || NEW.from_user_name
            || ' at ' || v_where || ' (' || NEW.handover_no || ').'
            || CASE WHEN round(COALESCE(NEW.variance, 0), 2) <> 0
                    THEN ' It is out by ₹' || to_char(abs(NEW.variance), 'FM99,99,99,990')
                         || ' against the software.'
                    ELSE ' It matches the software.' END,
          v_verifier.user_id, NULL,
          'cash_handovers', NEW.id::TEXT,
          jsonb_build_object('handoverNo', NEW.handover_no, 'amount', NEW.counted_cash,
                             'variance', NEW.variance, 'action', 'verify')
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_cash_handover ON public.cash_handovers;
CREATE TRIGGER trg_notify_cash_handover
  AFTER INSERT OR UPDATE ON public.cash_handovers
  FOR EACH ROW EXECUTE FUNCTION public.notify_cash_handover();

DO $verify$
DECLARE
  v_a UUID; v_b UUID; v_h UUID; v_n INT; v_v INT;
BEGIN
  SELECT id INTO v_a FROM "User" WHERE lower(email) = 'nisha@gmail.com';
  SELECT id INTO v_b FROM "User" WHERE lower(email) = 'avni@gmail.com';

  INSERT INTO cash_handovers (handover_no, hospital_type, from_user_id, from_user_name,
                              to_user_id, to_user_name, period_from, period_to,
                              expected_cash, counted_cash, status)
  VALUES ('CH-NOTIFYTEST', 'hope', v_a, 'Nisha Sharma', v_b, 'Avni', now(), now(), 500, 500, 'SUBMITTED')
  RETURNING id INTO v_h;

  SELECT count(*) INTO v_n FROM notifications
   WHERE source_id = v_h::TEXT AND notification_type = 'cash_handover_pending'
     AND recipient_user_id = v_b;
  IF v_n <> 1 THEN
    DELETE FROM notifications WHERE source_id = v_h::TEXT;
    DELETE FROM cash_handovers WHERE id = v_h;
    RAISE EXCEPTION 'ABORT: the receiver was not notified (got %)', v_n;
  END IF;

  UPDATE cash_handovers SET status = 'ACCEPTED' WHERE id = v_h;
  SELECT count(*) INTO v_v FROM notifications
   WHERE source_id = v_h::TEXT AND notification_type = 'cash_handover_verify';
  IF v_v < 1 THEN
    DELETE FROM notifications WHERE source_id = v_h::TEXT;
    DELETE FROM cash_handovers WHERE id = v_h;
    RAISE EXCEPTION 'ABORT: no verifier was notified';
  END IF;

  -- The person who handed it over must never be asked to verify it.
  IF EXISTS (SELECT 1 FROM notifications
              WHERE source_id = v_h::TEXT AND notification_type = 'cash_handover_verify'
                AND recipient_user_id = v_a) THEN
    DELETE FROM notifications WHERE source_id = v_h::TEXT;
    DELETE FROM cash_handovers WHERE id = v_h;
    RAISE EXCEPTION 'ABORT: the submitter was asked to verify their own count';
  END IF;

  DELETE FROM notifications WHERE source_id = v_h::TEXT;
  DELETE FROM cash_handovers WHERE id = v_h;
END
$verify$;

NOTIFY pgrst, 'reload schema';
