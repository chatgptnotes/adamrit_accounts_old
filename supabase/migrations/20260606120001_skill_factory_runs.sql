-- Skill Factory v2 — execution RUN LOG.
-- One row per "Execute" of a task: which steps ran, whether each auto step's
-- action succeeded, and what each manual step was assigned to. Kept as an audit
-- trail so staff/admins can see what the automation actually did. step_results
-- is JSONB so it carries any number of step outcomes without extra tables.
--
-- Same custom-auth pattern: anon key, RLS disabled, scoped by user_email/hospital_type.
CREATE TABLE IF NOT EXISTS public.skill_factory_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL,
  user_email    text NOT NULL,
  hospital_type text,
  status        text NOT NULL DEFAULT 'running',   -- running | done | failed
  step_results  jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{stepId,label,mode,actionType,ok,message}]
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_skill_factory_runs_task
  ON public.skill_factory_runs (task_id, started_at DESC);

COMMENT ON TABLE public.skill_factory_runs IS
  'Skill Factory task execution log (per-step results), scoped by user_email/hospital_type.';

ALTER TABLE public.skill_factory_runs DISABLE ROW LEVEL SECURITY;
