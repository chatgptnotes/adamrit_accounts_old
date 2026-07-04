-- Tally-style account groups:
--  * extend ledger_groups with alias, parent (Under), and Tally behaviour flags
--  * seed Tally's 28 predefined groups so "Under" offers the standard list

ALTER TABLE public.ledger_groups
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS parent_group_id UUID REFERENCES public.ledger_groups(id),
  ADD COLUMN IF NOT EXISTS behaves_like_subledger BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS net_debit_credit_balances BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS used_for_calculation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_method TEXT NOT NULL DEFAULT 'Not Applicable',
  ADD COLUMN IF NOT EXISTS is_predefined BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- The table was created out-of-band with CHECK constraints on nature/group_type
-- that reject Tally's values — drop them; the seeded values define the domain.
ALTER TABLE public.ledger_groups DROP CONSTRAINT IF EXISTS ledger_groups_nature_check;
ALTER TABLE public.ledger_groups DROP CONSTRAINT IF EXISTS ledger_groups_group_type_check;

-- Group names must be unique (needed for the seed upserts below too).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_groups_name_key'
  ) THEN
    ALTER TABLE public.ledger_groups ADD CONSTRAINT ledger_groups_name_key UNIQUE (name);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_ledger_groups_updated_at ON public.ledger_groups;
CREATE TRIGGER update_ledger_groups_updated_at
  BEFORE UPDATE ON public.ledger_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Match the access pattern used by other operational tables in this app.
ALTER TABLE public.ledger_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on ledger_groups" ON public.ledger_groups;
CREATE POLICY "Allow all operations on ledger_groups"
  ON public.ledger_groups
  FOR ALL USING (true) WITH CHECK (true);

-- Tally's 15 primary (top-level) groups
INSERT INTO public.ledger_groups (name, group_type, nature, is_predefined)
VALUES
  ('Capital Account',        'Liabilities', 'Credit', true),
  ('Loans (Liability)',      'Liabilities', 'Credit', true),
  ('Current Liabilities',    'Liabilities', 'Credit', true),
  ('Branch / Divisions',     'Liabilities', 'Credit', true),
  ('Suspense A/c',           'Liabilities', 'Credit', true),
  ('Fixed Assets',           'Assets',      'Debit',  true),
  ('Investments',            'Assets',      'Debit',  true),
  ('Current Assets',         'Assets',      'Debit',  true),
  ('Misc. Expenses (ASSET)', 'Assets',      'Debit',  true),
  ('Sales Accounts',         'Income',      'Credit', true),
  ('Direct Incomes',         'Income',      'Credit', true),
  ('Indirect Incomes',       'Income',      'Credit', true),
  ('Purchase Accounts',      'Expenses',    'Debit',  true),
  ('Direct Expenses',        'Expenses',    'Debit',  true),
  ('Indirect Expenses',      'Expenses',    'Debit',  true)
ON CONFLICT (name) DO NOTHING;

-- Tally's 13 predefined sub-groups
INSERT INTO public.ledger_groups (name, group_type, nature, parent_group_id, is_predefined)
SELECT v.name, v.group_type, v.nature, p.id, true
FROM (VALUES
  ('Reserves & Surplus',        'Liabilities', 'Credit', 'Capital Account'),
  ('Bank OD A/c',               'Liabilities', 'Credit', 'Loans (Liability)'),
  ('Secured Loans',             'Liabilities', 'Credit', 'Loans (Liability)'),
  ('Unsecured Loans',           'Liabilities', 'Credit', 'Loans (Liability)'),
  ('Duties & Taxes',            'Liabilities', 'Credit', 'Current Liabilities'),
  ('Provisions',                'Liabilities', 'Credit', 'Current Liabilities'),
  ('Sundry Creditors',          'Liabilities', 'Credit', 'Current Liabilities'),
  ('Bank Accounts',             'Assets',      'Debit',  'Current Assets'),
  ('Cash-in-Hand',              'Assets',      'Debit',  'Current Assets'),
  ('Deposits (Asset)',          'Assets',      'Debit',  'Current Assets'),
  ('Loans & Advances (Asset)',  'Assets',      'Debit',  'Current Assets'),
  ('Stock-in-Hand',             'Assets',      'Debit',  'Current Assets'),
  ('Sundry Debtors',            'Assets',      'Debit',  'Current Assets')
) AS v(name, group_type, nature, parent_name)
JOIN public.ledger_groups p ON p.name = v.parent_name
ON CONFLICT (name) DO NOTHING;

-- Make PostgREST pick up the new columns immediately.
NOTIFY pgrst, 'reload schema';
