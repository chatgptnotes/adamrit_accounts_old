-- Follow-up comments for a saved Referral Register entry. The parent entry
-- itself stays append-only/immutable (see 20260710160000); users who need to
-- record something after saving add a new comment row instead of editing it.

CREATE TABLE IF NOT EXISTS public.referral_register_entry_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.referral_register_entries(id) ON DELETE CASCADE,
  comment text NOT NULL,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_register_entry_comments_entry_idx
ON public.referral_register_entry_comments (entry_id);

ALTER TABLE public.referral_register_entry_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_register_entry_comments'
      AND policyname = 'Allow read on referral_register_entry_comments'
  ) THEN
    CREATE POLICY "Allow read on referral_register_entry_comments"
    ON public.referral_register_entry_comments FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_register_entry_comments'
      AND policyname = 'Allow insert on referral_register_entry_comments'
  ) THEN
    CREATE POLICY "Allow insert on referral_register_entry_comments"
    ON public.referral_register_entry_comments FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

REVOKE UPDATE, DELETE ON public.referral_register_entry_comments FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
