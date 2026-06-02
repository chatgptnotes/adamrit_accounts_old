-- Email logs: tracks every corporate email sent via the automation
CREATE TABLE IF NOT EXISTS email_logs (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient      TEXT        NOT NULL,
  corporate_name TEXT,
  subject        TEXT        NOT NULL,
  template_type  TEXT,       -- 'billing_summary' | 'payment_reminder' | 'custom'
  status         TEXT        NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed'
  resend_id      TEXT,       -- message ID returned by Resend API
  error_message  TEXT,
  sent_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_logs DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at    ON email_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_corporate  ON email_logs(corporate_name);
CREATE INDEX IF NOT EXISTS idx_email_logs_status     ON email_logs(status);
