-- Daily background run of the deadline automations (run-deadline-automations
-- edge function), so deadline_due / deadline_overdue flows fire even when nobody
-- has the Deadline Tracking page open.
-- Runs at 4:00 AM UTC (9:30 AM IST), just after the payment-deadline digest.

CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove existing job if it exists (idempotent re-run).
DO $$
BEGIN
    PERFORM cron.unschedule('run-deadline-automations-daily');
EXCEPTION
    WHEN undefined_object THEN
        NULL; -- Job doesn't exist yet, that's fine
END
$$;

SELECT cron.schedule(
    'run-deadline-automations-daily',
    '0 4 * * *', -- Every day at 4:00 AM UTC (9:30 AM IST)
    $$
    SELECT
      net.http_post(
          url := 'https://xvkxccqaopbnkvwgyfjv.supabase.co/functions/v1/run-deadline-automations',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
          ),
          body := '{}'::jsonb
      ) as request_id;
    $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'run-deadline-automations-daily';

-- Status view for this job (mirrors the admission-reminder one).
CREATE OR REPLACE VIEW deadline_automations_cron_status AS
SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    jr.start_time   AS last_run_start,
    jr.end_time     AS last_run_end,
    jr.status       AS last_run_status,
    jr.return_message AS last_run_message
FROM cron.job j
LEFT JOIN cron.job_run_details jr ON j.jobid = jr.jobid
WHERE j.jobname = 'run-deadline-automations-daily'
ORDER BY jr.start_time DESC
LIMIT 1;

GRANT SELECT ON deadline_automations_cron_status TO authenticated;

-- Manual test trigger:
-- SELECT net.http_post(
--     url := 'https://xvkxccqaopbnkvwgyfjv.supabase.co/functions/v1/run-deadline-automations',
--     headers := jsonb_build_object('Content-Type', 'application/json'),
--     body := '{}'::jsonb
-- );
