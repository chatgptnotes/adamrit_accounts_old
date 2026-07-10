-- Append-only Referral Register. Each row snapshots a visit's referral
-- details at the time of entry, plus any changes the user wants to record.
-- RLS grants SELECT and INSERT only — rows can never be updated or deleted
-- through the API.

CREATE TABLE IF NOT EXISTS public.referral_register_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_uuid uuid,
  visit_id text NOT NULL,
  admission_date date,
  patient_name text NOT NULL,
  panel text,
  marketing_executive text,
  referral_doctor text,
  shifted_from_ayushman_opd boolean,
  executive_referral_doctor text,
  changes_note text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_register_entries_admission_idx
ON public.referral_register_entries (admission_date);

ALTER TABLE public.referral_register_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_register_entries'
      AND policyname = 'Allow read on referral_register_entries'
  ) THEN
    CREATE POLICY "Allow read on referral_register_entries"
    ON public.referral_register_entries FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_register_entries'
      AND policyname = 'Allow insert on referral_register_entries'
  ) THEN
    CREATE POLICY "Allow insert on referral_register_entries"
    ON public.referral_register_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

REVOKE UPDATE, DELETE ON public.referral_register_entries FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
