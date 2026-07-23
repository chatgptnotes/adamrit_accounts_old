-- Master table for the Advance Statement / workflow status dropdown.
-- Editable via the Status Master page; seeded with the 12 workflow statuses
-- plus the 4 government-portal lifecycle statuses.
CREATE TABLE IF NOT EXISTS public.workflow_status_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  value text NOT NULL UNIQUE,
  label text NOT NULL,
  workflow text,          -- approval | extension | discharge | bill | submission | payment | NULL
  stage text,             -- pending | done | NULL
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.workflow_status_master (value, label, workflow, stage, sort_order) VALUES
  ('pre_auth_to_be_submitted', 'Pre-authorization to be submitted', NULL, NULL, 10),
  ('pre_auth_pending',         'Pre-authorization pending',         NULL, NULL, 20),
  ('under_treatment',          'Under treatment',                   NULL, NULL, 30),
  ('claims_to_be_submitted',   'Claims to be submitted',            NULL, NULL, 40),
  ('approval_pending',    'Approval Pending',    'approval',   'pending', 110),
  ('extension_pending',   'Extension Pending',   'extension',  'pending', 120),
  ('discharge_pending',   'Discharge Pending',   'discharge',  'pending', 130),
  ('bill_pending',        'Bill Pending',        'bill',       'pending', 140),
  ('submission_pending',  'Submission Pending',  'submission', 'pending', 150),
  ('payment_pending',     'Payment Pending',     'payment',    'pending', 160),
  ('approval_received',   'Approval Received',   'approval',   'done',    210),
  ('extension_received',  'Extension Received',  'extension',  'done',    220),
  ('discharge_done',      'Discharge Done',      'discharge',  'done',    230),
  ('bill_done',           'Bill Done',           'bill',       'done',    240),
  ('submission_done',     'Submission Done',     'submission', 'done',    250),
  ('payment_received',    'Payment Received',    'payment',    'done',    260)
ON CONFLICT (value) DO NOTHING;

NOTIFY pgrst, 'reload schema';
