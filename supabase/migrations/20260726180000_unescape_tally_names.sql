-- Un-escape the HTML entities the Tally import stored raw.
--
-- Tally's XML arrives escaped, and `getVal` in both tally proxies only trimmed
-- the extracted value. So "Duties & Taxes" was stored as "Duties &amp; Taxes"
-- and appears in reports as a group distinct from any correctly-spelled twin.
-- 69 stored values are affected, overwhelmingly `&amp;`.
--
-- Two consequences beyond cosmetics:
--   * `Loans &amp; Advances (Asset)` and `Loans & Advances (Asset)` show as two
--     separate groups with their balances split between them.
--   * `Profit &amp; Loss A/c` never matched heads.ts's reserved
--     PNL_LEDGER_NAME, so it was not being classified as its own primary group
--     the way TallyPrime does.
--
-- Numeric control-character entities (`&#4; Primary`) are junk from the export
-- and are stripped rather than decoded - decoding would embed an invisible
-- control byte in an account name.
--
-- The proxies now un-escape at import (api/tally-proxy.ts,
-- supabase/functions/tally-proxy/index.ts), so a resync will not reintroduce
-- this.

CREATE OR REPLACE FUNCTION public.unescape_tally_text(p TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  -- &amp; last, so a doubly-escaped value unwinds one level only.
  SELECT btrim(
    replace(
      replace(
        replace(
          replace(
            replace(
              regexp_replace(COALESCE(p, ''), '&#(?:[0-9]|[12][0-9]|3[01]);', '', 'g'),
            '&lt;', '<'),
          '&gt;', '>'),
        '&quot;', '"'),
      '&#39;', ''''),
    '&amp;', '&')
  );
$$;

-- chart_of_accounts: no uniqueness on either column, so a straight update.
-- Values that collapse onto an existing name simply merge, which is the point.
UPDATE public.chart_of_accounts
   SET account_group = public.unescape_tally_text(account_group)
 WHERE account_group ~ '&[a-zA-Z]+;|&#[0-9]+;';

UPDATE public.chart_of_accounts
   SET account_name = public.unescape_tally_text(account_name)
 WHERE account_name ~ '&[a-zA-Z]+;|&#[0-9]+;';

-- Parent-group references carry no constraint either.
UPDATE public.tally_groups
   SET parent_group = public.unescape_tally_text(parent_group)
 WHERE parent_group ~ '&[a-zA-Z]+;|&#[0-9]+;';

UPDATE public.tally_ledgers
   SET parent_group = public.unescape_tally_text(parent_group)
 WHERE parent_group ~ '&[a-zA-Z]+;|&#[0-9]+;';

UPDATE public.tally_ledgers
   SET name = public.unescape_tally_text(name)
 WHERE name ~ '&[a-zA-Z]+;|&#[0-9]+;'
   AND NOT EXISTS (
     SELECT 1 FROM public.tally_ledgers t2
      WHERE t2.company_id IS NOT DISTINCT FROM public.tally_ledgers.company_id
        AND t2.name = public.unescape_tally_text(public.tally_ledgers.name)
        AND t2.id <> public.tally_ledgers.id);

-- tally_groups.name is unique per company. Where the clean name already exists
-- the escaped row is a duplicate of it: repoint anything referencing the
-- escaped spelling, then drop it. Otherwise just rename in place.
UPDATE public.tally_groups g
   SET name = public.unescape_tally_text(g.name)
 WHERE g.name ~ '&[a-zA-Z]+;|&#[0-9]+;'
   AND NOT EXISTS (
     SELECT 1 FROM public.tally_groups t2
      WHERE t2.company_id IS NOT DISTINCT FROM g.company_id
        AND t2.name = public.unescape_tally_text(g.name)
        AND t2.id <> g.id);

DELETE FROM public.tally_groups g
 WHERE g.name ~ '&[a-zA-Z]+;|&#[0-9]+;'
   AND EXISTS (
     SELECT 1 FROM public.tally_groups t2
      WHERE t2.company_id IS NOT DISTINCT FROM g.company_id
        AND t2.name = public.unescape_tally_text(g.name)
        AND t2.id <> g.id);
