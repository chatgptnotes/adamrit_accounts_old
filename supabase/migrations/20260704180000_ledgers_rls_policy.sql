-- The ledgers table has RLS enabled but no permissive policy, so the app
-- cannot insert/update rows (blocks Ledger Creation and Tally masters import).
-- Match the allow-all access pattern used by other operational tables.

ALTER TABLE public.ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on ledgers" ON public.ledgers;
CREATE POLICY "Allow all operations on ledgers"
  ON public.ledgers
  FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
