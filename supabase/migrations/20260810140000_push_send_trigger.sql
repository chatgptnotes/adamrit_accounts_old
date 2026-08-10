-- Phone push notifications, part 2 of 2: every new alert wakes the phones.
--
-- AFTER INSERT on public.notifications → pg_net POST to /api/push-send on
-- Vercel, which fans the alert out to every subscribed device. pg_net only
-- QUEUES the request (a background worker delivers it), so the insert itself
-- never waits on the network; the exception guard is belt-and-braces so a
-- misconfigured setting can never roll back the alert row either.
--
-- Auth: reuses app.settings.service_role_key — the same database setting every
-- existing pg_net cron depends on — as the bearer token. api/push-send.ts
-- verifies it against SUPABASE_SERVICE_ROLE_KEY. No new secret to provision.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- pg_net is already installed (every existing WhatsApp cron posts through
-- net.http_post). CREATE EXTENSION needs superuser, which apply_migration()
-- does not have — so verify instead of create.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'ABORT: pg_net extension is not installed';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.notify_push_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  v_key := current_setting('app.settings.service_role_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'push skipped: app.settings.service_role_key is not set';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://adamrit.com/api/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('notification_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push must never cost us the alert row itself.
  RAISE WARNING 'push enqueue failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_push ON public.notifications;
CREATE TRIGGER trg_notifications_push
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.notify_push_on_notification();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_notifications_push'
       AND tgrelid = 'public.notifications'::regclass
  ) THEN
    RAISE EXCEPTION 'ABORT: trg_notifications_push was not created';
  END IF;
  RAISE NOTICE 'OK — new notifications will be pushed to subscribed phones';
END $$;
