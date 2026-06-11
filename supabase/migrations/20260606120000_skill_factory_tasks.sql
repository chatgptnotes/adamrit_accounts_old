-- Skill Factory v2 — per-staff TASKS.
-- Each row is one task a staff member has captured on the /skill-factory page:
-- the AI "Process Coach" interviews them on how the task is done, then commits a
-- step-by-step plan that marks which steps can be automated. Everything that can
-- vary in size (the interview transcript, the steps) is stored as JSONB so a task
-- needs no extra tables.
--
-- Custom-auth app pattern (matches task_optimizer_flows / skill_factory_subagents):
-- the browser uses the anon key and scopes every query at the query layer by the
-- logged-in user's email, so RLS is disabled. Admins read across all staff by
-- dropping the user_email filter (scoped to their hospital_type instead).
CREATE TABLE IF NOT EXISTS public.skill_factory_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email         text NOT NULL,                       -- owner (scoping key)
  hospital_type      text,                                -- tenant (admin scoping)
  owner_role         text,                                -- staff role at capture time
  title              text NOT NULL,
  description        text,
  category           text,                                -- optional grouping (e.g. department)
  status             text NOT NULL DEFAULT 'capturing',   -- capturing | designed | active | archived
  interview          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{role, content}] chat transcript
  steps              jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,label,type,mode,actionType,config,how,assignee}]
  automation_summary text,                                -- plain-Hinglish "what we can automate"
  automation_score   integer NOT NULL DEFAULT 0,          -- 0-100, how automatable
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_factory_tasks_user
  ON public.skill_factory_tasks (user_email, sort_order);
CREATE INDEX IF NOT EXISTS idx_skill_factory_tasks_hospital
  ON public.skill_factory_tasks (hospital_type);

COMMENT ON TABLE public.skill_factory_tasks IS
  'Per-staff Skill Factory tasks (interview + automatable steps), scoped by user_email; admins read by hospital_type.';

-- Matches the app pattern: browser uses the anon key under custom auth.
ALTER TABLE public.skill_factory_tasks DISABLE ROW LEVEL SECURITY;
