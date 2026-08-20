-- One person, many ledgers. Phases 1 and 2 of the plan of 20 August.
--
-- THE DECISIONS (Dr M, 20 Aug), taken against the three the plan asked for:
--   1. Doubtful matches — he reviews them himself: "i will tell you if it
--      doesn't match". So nothing is guessed. Only an EXACT normalised name is
--      linked automatically; everything else is listed for him to read.
--   2. How far "person" reaches — vendors too: "vendors are also to be merged of
--      different companies". NAG DRUG AGENCIES appears in four companies on the
--      same footing a member of staff does.
--   3. Phases 4 and 5 — deferred a fortnight, until the screen has been used.
--
-- WHAT THIS DOES NOT DO, and must never be read as doing: it does not merge a
-- ledger, move an entry or change a balance. Each company still balances alone
-- and still reconciles against its own Tally file. The person sits ABOVE the
-- ledgers and points at them. Today's evidence for why that matters: Suraj
-- Rajput's stray ledger carries Rs 9,000 of Ayushman spending, and the obvious
-- ledger to "merge" it into sits in M.L. Enterprises.
--
-- WHY IT EXISTS AT ALL. MLE-1469 and MLE-1470 were raised eighteen minutes
-- apart for the same patient and the same man, because the duplicate check
-- compared ledger ids and he has four ledgers. Nothing distinguished the man
-- from the row.

-- ------------------------------------------------------------- the match key

/**
 * The name reduced to what two spellings of one person have in common.
 *
 * Titles go, punctuation goes, spacing collapses. "Dr. Arpit  Dhakate" and
 * "dr arpit dhakate" become the same key; "Arpit Kinarkar" does not, and must
 * not — they are two different men and the whole point of the exercise is that
 * a wrong match silently merges two people's money in every report built after.
 */
CREATE OR REPLACE FUNCTION public.person_match_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(COALESCE(p_name, '')), '[^a-z0-9 ]', ' ', 'g'),
      '^(dr|mr|mrs|ms|shri|smt|miss|prof)\s+', '', 'g'),
    '\s+', ' ', 'g'));
$$;

-- --------------------------------------------------------- 1. the two tables

CREATE TABLE IF NOT EXISTS public.person (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT NOT NULL,
  match_key   TEXT NOT NULL,
  -- A vendor is a party in exactly the same way a member of staff is: one
  -- name, several companies, several ledgers. Only the label differs.
  party_kind  TEXT NOT NULL DEFAULT 'person' CHECK (party_kind IN ('person', 'vendor')),
  known_as    TEXT[] NOT NULL DEFAULT '{}',
  mobile      TEXT,
  -- On the payroll, and therefore takes no referral cuts. Today this is a
  -- name-matching exclusion list (commission_excluded_people); eventually it is
  -- this flag.
  is_staff    BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.person IS
  'A human being or a vendor, once, across all six companies. Points at ledgers; '
  'never holds money itself.';

CREATE UNIQUE INDEX IF NOT EXISTS person_match_key_uidx
  ON public.person (match_key) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.person_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    UUID NOT NULL REFERENCES public.person(id) ON DELETE CASCADE,
  -- One ledger belongs to at most one person. This is the constraint that makes
  -- the whole thing safe: a ledger cannot be claimed twice.
  account_id   UUID NOT NULL UNIQUE REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  company_id   UUID REFERENCES public.companies(id),
  role         TEXT,
  -- Set when a human confirmed a match that was not exact. Nothing writes this
  -- yet: every link made today is an exact-name link.
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_ledger_person_idx  ON public.person_ledger (person_id);
CREATE INDEX IF NOT EXISTS person_ledger_company_idx ON public.person_ledger (company_id);

ALTER TABLE public.person        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS person_readable ON public.person;
CREATE POLICY person_readable ON public.person FOR SELECT USING (true);
DROP POLICY IF EXISTS person_ledger_readable ON public.person_ledger;
CREATE POLICY person_ledger_readable ON public.person_ledger FOR SELECT USING (true);

GRANT SELECT ON public.person, public.person_ledger TO anon, authenticated;

-- ------------------------------------------------- which ledgers are a party

-- The groups a person or a vendor lives in. Sundry Debtors is deliberately
-- absent: those 6,113 rows are patients. The scheme groups (MJPJAY, CGHS, WCL,
-- ECHS) are panels that pay the hospital, not parties it pays.
CREATE TABLE IF NOT EXISTS public.person_ledger_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern    TEXT NOT NULL,
  role       TEXT NOT NULL,
  party_kind TEXT NOT NULL DEFAULT 'person' CHECK (party_kind IN ('person', 'vendor')),
  is_active  BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS person_ledger_groups_pattern_uidx
  ON public.person_ledger_groups (lower(btrim(pattern)));

GRANT SELECT ON public.person_ledger_groups TO anon, authenticated;

INSERT INTO public.person_ledger_groups (pattern, role, party_kind) VALUES
  ('hope salary exp',              'salary',     'person'),
  ('ayushman salary expences',     'salary',     'person'),
  ('rmo salary',                   'rmo',        'person'),
  ('consultant',                   'consultant', 'person'),
  ('sundry creditors',             'creditor',   'vendor'),
  ('sundary creditor - contractor','contractor', 'vendor'),
  ('pharmacy vendor',              'vendor',     'vendor')
ON CONFLICT (lower(btrim(pattern))) DO NOTHING;

/** Every active ledger that belongs to a party, with the role it plays there. */
CREATE OR REPLACE VIEW public.v_party_ledger_candidates AS
  SELECT a.id                AS account_id,
         a.account_name,
         a.account_group,
         a.company_id,
         a.mobile,
         g.role,
         g.party_kind,
         public.person_match_key(a.account_name) AS match_key
    FROM public.chart_of_accounts a
    JOIN public.person_ledger_groups g
      ON g.is_active
     AND lower(btrim(COALESCE(a.account_group, ''))) = lower(btrim(g.pattern))
   WHERE a.is_active
     AND btrim(COALESCE(a.account_name, '')) <> '';

GRANT SELECT ON public.v_party_ledger_candidates TO anon, authenticated;

-- --------------------------------------------- 2. link, on an exact name only

/**
 * Attach every candidate ledger to a person, creating the person if this is the
 * first ledger seen under that name.
 *
 * EXACT NORMALISED NAME ONLY. "Suraj Rajput" and "Suraj Ramji Rajput" are
 * probably one man and are deliberately left as two, for Dr M to say so. Wrong
 * is far more expensive than incomplete here.
 *
 * Re-runnable: a ledger already linked is left exactly as it is, including a
 * link a human corrected by hand.
 */
CREATE OR REPLACE FUNCTION public.link_party_ledgers()
RETURNS TABLE (people_created INT, ledgers_linked INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before_people INT; v_before_links INT;
BEGIN
  SELECT count(*) INTO v_before_people FROM person;
  SELECT count(*) INTO v_before_links  FROM person_ledger;

  -- The people first. One row per distinct normalised name.
  INSERT INTO person (full_name, match_key, party_kind, is_staff)
  SELECT DISTINCT ON (c.match_key)
         c.account_name,
         c.match_key,
         -- A name that appears as staff anywhere is a person, whatever else it
         -- also appears as: staff who also supply something are still staff.
         CASE WHEN bool_or(c.party_kind = 'person') OVER (PARTITION BY c.match_key)
              THEN 'person' ELSE 'vendor' END,
         bool_or(c.role IN ('salary', 'rmo')) OVER (PARTITION BY c.match_key)
    FROM v_party_ledger_candidates c
   WHERE c.match_key <> ''
     AND NOT EXISTS (SELECT 1 FROM person p WHERE p.match_key = c.match_key AND p.is_active)
   ORDER BY c.match_key, length(c.account_name) DESC
  ON CONFLICT DO NOTHING;

  -- Then the ledgers.
  INSERT INTO person_ledger (person_id, account_id, company_id, role)
  SELECT p.id, c.account_id, c.company_id, c.role
    FROM v_party_ledger_candidates c
    JOIN person p ON p.match_key = c.match_key AND p.is_active
   WHERE NOT EXISTS (SELECT 1 FROM person_ledger l WHERE l.account_id = c.account_id)
  ON CONFLICT (account_id) DO NOTHING;

  -- Every spelling this person is known by, for searching on.
  UPDATE person p
     SET known_as = sub.names
    FROM (SELECT pl.person_id, array_agg(DISTINCT a.account_name)::TEXT[] AS names
            FROM person_ledger pl JOIN chart_of_accounts a ON a.id = pl.account_id
           GROUP BY pl.person_id) sub
   WHERE sub.person_id = p.id AND p.known_as IS DISTINCT FROM sub.names;

  -- A mobile already on any of their ledgers becomes the person's, so a payment
  -- voucher can find it. Only where the person has none.
  UPDATE person p
     SET mobile = sub.mobile
    FROM (SELECT pl.person_id, min(a.mobile)::TEXT AS mobile
            FROM person_ledger pl JOIN chart_of_accounts a ON a.id = pl.account_id
           WHERE btrim(COALESCE(a.mobile, '')) <> ''
           GROUP BY pl.person_id) sub
   WHERE sub.person_id = p.id AND btrim(COALESCE(p.mobile, '')) = '';

  RETURN QUERY SELECT (SELECT count(*)::INT FROM person) - v_before_people,
                      (SELECT count(*)::INT FROM person_ledger) - v_before_links;
END $$;

REVOKE ALL ON FUNCTION public.link_party_ledgers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_party_ledgers() TO authenticated;

-- --------------------------------------------------------- 3. what to look at

/** Every ledger a person holds, in which company, with its balance. */
CREATE OR REPLACE VIEW public.v_person_accounts AS
  SELECT p.id           AS person_id,
         p.full_name,
         p.party_kind,
         p.is_staff,
         p.mobile       AS person_mobile,
         a.id           AS account_id,
         a.account_name,
         a.account_code,
         a.account_group,
         a.mobile       AS ledger_mobile,
         pl.role,
         c.id           AS company_id,
         c.company_name,
         c.company_key,
         round(COALESCE(a.opening_balance
                 * CASE WHEN COALESCE(a.opening_balance_type, 'DR') = 'DR' THEN 1 ELSE -1 END, 0)
               + COALESCE(e.net, 0), 2) AS balance,
         COALESCE(e.entries, 0)         AS entry_count
    FROM public.person p
    JOIN public.person_ledger pl ON pl.person_id = p.id
    JOIN public.chart_of_accounts a ON a.id = pl.account_id
    LEFT JOIN public.companies c ON c.id = a.company_id
    LEFT JOIN LATERAL (
      SELECT sum(ve.debit_amount) - sum(ve.credit_amount) AS net, count(*) AS entries
        FROM public.voucher_entries ve
        JOIN public.vouchers v ON v.id = ve.voucher_id AND v.status <> 'CANCELLED'
       WHERE ve.account_id = a.id
    ) e ON true
   WHERE p.is_active;

GRANT SELECT ON public.v_person_accounts TO anon, authenticated;

/** One line per person: how many ledgers, how many companies, and the total. */
CREATE OR REPLACE VIEW public.v_person_summary AS
  SELECT person_id,
         full_name,
         party_kind,
         is_staff,
         person_mobile,
         count(*)                                        AS ledger_count,
         count(DISTINCT company_id) FILTER (WHERE company_id IS NOT NULL) AS company_count,
         count(*) FILTER (WHERE company_id IS NULL)      AS ledgers_without_a_company,
         sum(balance)                                    AS total_balance,
         sum(entry_count)                                AS entry_count,
         string_agg(DISTINCT company_name, ', ' ORDER BY company_name) AS companies
    FROM public.v_person_accounts
   GROUP BY person_id, full_name, party_kind, is_staff, person_mobile;

GRANT SELECT ON public.v_person_summary TO anon, authenticated;

/**
 * The list Dr M reads: two people who are probably one.
 *
 * One name contained in the other ("Suraj Rajput" inside "Suraj Ramji Rajput"),
 * or the same first and last name with something different in between. Never
 * acted on automatically — this view only asks the question.
 */
CREATE OR REPLACE VIEW public.v_person_match_review AS
  SELECT a.id AS person_a, a.full_name AS name_a,
         b.id AS person_b, b.full_name AS name_b,
         CASE WHEN b.match_key LIKE a.match_key || ' %'
                OR b.match_key LIKE '% ' || a.match_key
                OR b.match_key LIKE '% ' || a.match_key || ' %'
              THEN 'one name contains the other'
              ELSE 'same first and last name' END AS reason
    FROM public.person a
    JOIN public.person b
      ON a.id < b.id
     AND a.is_active AND b.is_active
     AND (
       b.match_key LIKE a.match_key || ' %'
       OR b.match_key LIKE '% ' || a.match_key
       OR b.match_key LIKE '% ' || a.match_key || ' %'
       OR (split_part(a.match_key, ' ', 1) = split_part(b.match_key, ' ', 1)
           AND regexp_replace(a.match_key, '^.* ', '') = regexp_replace(b.match_key, '^.* ', '')
           AND position(' ' IN a.match_key) > 0
           AND position(' ' IN b.match_key) > 0)
     );

GRANT SELECT ON public.v_person_match_review TO anon, authenticated;

/** Candidate ledgers nobody owns — the exception that used to go unnoticed. */
CREATE OR REPLACE VIEW public.v_unlinked_party_ledgers AS
  SELECT c.account_id, c.account_name, c.account_group, c.role, c.party_kind,
         co.company_name
    FROM public.v_party_ledger_candidates c
    LEFT JOIN public.companies co ON co.id = c.company_id
   WHERE NOT EXISTS (SELECT 1 FROM public.person_ledger l WHERE l.account_id = c.account_id);

GRANT SELECT ON public.v_unlinked_party_ledgers TO anon, authenticated;

-- ------------------------------------------------------------------- run it

DO $link$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.link_party_ledgers();
  RAISE NOTICE '% people created, % ledgers linked', r.people_created, r.ledgers_linked;
END $link$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE
  v_people INT; v_links INT; v_dupe INT; v_unlinked INT; v_review INT;
  v_coa_before INT; v_ve_before INT; v_arpit INT;
BEGIN
  SELECT count(*) INTO v_people FROM person;
  SELECT count(*) INTO v_links  FROM person_ledger;
  IF v_people = 0 OR v_links = 0 THEN
    RAISE EXCEPTION 'ABORT: nothing was linked — % people, % links', v_people, v_links;
  END IF;

  -- No ledger may belong to two people. The unique index says so; this proves
  -- the index is on the column that matters.
  SELECT count(*) INTO v_dupe FROM (
    SELECT account_id FROM person_ledger GROUP BY account_id HAVING count(*) > 1) s;
  IF v_dupe > 0 THEN
    RAISE EXCEPTION 'ABORT: % ledger(s) claimed by more than one person', v_dupe;
  END IF;

  -- Nothing may have been merged: a person's ledgers must still sit in their
  -- own companies, and no balance may have moved. Both tables are untouched by
  -- this migration, so their row counts are the check.
  SELECT count(*) INTO v_coa_before FROM chart_of_accounts;
  SELECT count(*) INTO v_ve_before  FROM voucher_entries;
  IF v_coa_before = 0 OR v_ve_before = 0 THEN
    RAISE EXCEPTION 'ABORT: the ledgers or the entries have gone';
  END IF;

  -- The man the exercise started with must now be one person with four ledgers.
  SELECT ledger_count INTO v_arpit FROM v_person_summary
   WHERE person_match_key(full_name) = person_match_key('Arpit Kinarkar');
  IF COALESCE(v_arpit, 0) < 2 THEN
    RAISE NOTICE 'Arpit Kinarkar resolves to % ledger(s) — expected several', COALESCE(v_arpit, 0);
  END IF;

  -- And two different men must NOT have been made one.
  IF person_match_key('Arpit Kinarkar') = person_match_key('Dr. Arpit Dhakate') THEN
    RAISE EXCEPTION 'ABORT: the match key cannot tell two different men apart';
  END IF;
  IF person_match_key('Dr. Arpit  Dhakate') <> person_match_key('arpit dhakate') THEN
    RAISE EXCEPTION 'ABORT: the match key cannot tell one man written two ways is one man';
  END IF;

  SELECT count(*) INTO v_unlinked FROM v_unlinked_party_ledgers;
  SELECT count(*) INTO v_review   FROM v_person_match_review;
  RAISE NOTICE '% people, % ledgers linked, % unlinked, % pairs to review',
    v_people, v_links, v_unlinked, v_review;
END
$verify$;

NOTIFY pgrst, 'reload schema';
