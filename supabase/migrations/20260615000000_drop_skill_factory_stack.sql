-- Teardown: drop the entire Skill Factory / Task Optimizer table stack.
-- The full schema is preserved in SKILL_FACTORY_BLUEPRINT.md (repo root) so the
-- feature can be rebuilt later from that one file.
--
-- DESTRUCTIVE + IRREVERSIBLE: this deletes all rows in these tables. CASCADE is
-- used so foreign-key dependencies (task_optimizer_actions -> task_optimizer_logs,
-- utility_deadlines.recipient_id -> slack_recipients) drop cleanly regardless of
-- order. Run in the Supabase SQL Editor, or `supabase db push`.

drop table if exists public.task_optimizer_actions   cascade;
drop table if exists public.task_optimizer_flows      cascade;
drop table if exists public.task_optimizer_logs       cascade;
drop table if exists public.skill_factory_runs        cascade;
drop table if exists public.skill_factory_tasks       cascade;
drop table if exists public.skill_factory_subagents   cascade;
drop table if exists public.utility_deadlines         cascade;
drop table if exists public.slack_recipients          cascade;
drop table if exists public.email_inbox               cascade;
