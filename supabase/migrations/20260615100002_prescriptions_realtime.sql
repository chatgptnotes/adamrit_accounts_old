-- Make the desktop pharmacy bell light up instantly when a med is approved on
-- the tablet. usePendingPrescriptions subscribes to realtime changes on
-- `prescriptions`; without the table in the supabase_realtime publication the
-- bell only updates on its 60s poll, so a phone approval can lag up to a minute.
--
-- Idempotent: only adds the table if it is not already published.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'prescriptions'
     )
  THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions';
  END IF;
END $$;
