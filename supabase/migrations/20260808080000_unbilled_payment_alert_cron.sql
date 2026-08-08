-- Check for unbilled payments twice a day and message the management.
--
-- 10:00 and 18:00 IST (04:30 and 12:30 UTC): late enough in the morning that
-- the previous evening's phone histories are in, and again before the phones
-- change hands for the night. Each exception is messaged once — the function
-- stamps alerted_at — so running twice a day cannot become nagging.
--
-- Same shape as send-payment-deadline-digest-daily, including its dependency
-- on app.settings.service_role_key being set on the database.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-unbilled-payment-alerts') THEN
    PERFORM cron.unschedule('send-unbilled-payment-alerts');
  END IF;
END $$;

SELECT cron.schedule(
  'send-unbilled-payment-alerts',
  '30 4,12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xvkxccqaopbnkvwgyfjv.supabase.co/functions/v1/send-unbilled-payment-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-unbilled-payment-alerts') THEN
    RAISE EXCEPTION 'ABORT: the alert schedule was not created';
  END IF;
  RAISE NOTICE 'OK — unbilled payments are checked at 10:00 and 18:00 IST';
END $$;
