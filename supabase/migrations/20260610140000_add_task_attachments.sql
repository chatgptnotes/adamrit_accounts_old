-- Per-task document scans for the Skill Factory.
-- task_attachments: keyed by task label (mirrors how subtasks are keyed), each
-- value an array of scanned-document records:
--   { title, summary, fields: [{label, value}], fileUrl, createdAt }
-- Additive + idempotent — does not touch existing rows or the tasks array.

ALTER TABLE public.task_optimizer_logs
  ADD COLUMN IF NOT EXISTS task_attachments jsonb NOT NULL DEFAULT '{}'::jsonb;
