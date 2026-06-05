-- Email inbox: stores emails processed by GAS (2x daily - 9 AM morning, 5 PM evening)
-- GAS writes here after classifying emails and preparing draft replies.
-- Staff approves/rejects from the Billing Dashboard Email Workflow tab.

CREATE TABLE IF NOT EXISTS email_inbox (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email   TEXT         NOT NULL,
  from_name    TEXT,
  subject      TEXT,
  body_preview TEXT,
  category     TEXT         CHECK (category IN ('billing', 'corporate', 'tpa', 'appointment', 'general', 'urgent')),
  urgency      TEXT         CHECK (urgency IN ('high', 'medium', 'low')),
  received_at  TIMESTAMPTZ,
  check_run    TEXT         CHECK (check_run IN ('morning', 'evening')),
  check_date   DATE,
  draft_reply  TEXT,
  status       TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent')),
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE email_inbox DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_email_inbox_check_date ON email_inbox (check_date DESC);
CREATE INDEX IF NOT EXISTS idx_email_inbox_status     ON email_inbox (status);
CREATE INDEX IF NOT EXISTS idx_email_inbox_category   ON email_inbox (category);
