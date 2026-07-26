-- Stop Tally overwriting Adamrit's figures in the reports.
--
-- mergedLedgerBalances merges a Tally ledger over an Adamrit one of the same
-- name, replacing the figure rather than adding to it. It does that whenever
-- exactly one ACTIVE tally_config matches the accounting company, using
-- companyKey() in src/lib/tallyCompanyMatch.ts - which strips the legal suffix,
-- so 'DRM Hope Hospital Private Limited' and 'Drm Hope Hospital Pvt Ltd' are
-- the same name.
--
-- Three companies were merging: DRM Hope Pvt Ltd, Ayushman Nagpur and Hope
-- Pharmacy. 5,242 of the 5,259 Tally ledgers share a name with an Adamrit
-- ledger, so almost everything was being displayed from Tally's last sync on
-- 24 July rather than from Adamrit's own postings. Twelve entries made since
-- the cutover were already hidden, and pharmacy purchases post under Hope
-- Pharmacy, so that number would have grown.
--
-- WHAT ELSE STOPS. is_active does not only gate the report merge:
--   * tally-auto-push.ts stops pushing bills and payments to Tally
--   * api/tally-proxy.ts refuses an inactive config, so syncing stops
-- Nothing has synced since 24 July, and Adamrit became the book of record on
-- the 25th, so both are consistent with how the system is now run. But if the
-- bank feed is still wanted, reactivate deliberately and settle the split
-- instead: Tally owning the bank ledgers, Adamrit owning everything else.
--
-- The Tally data itself is untouched. tally_ledgers keeps its 5,259 rows and
-- the configs keep their server settings; only the active flag changes.
--
-- To undo:
--   UPDATE tally_config SET is_active = true
--    WHERE id IN ( ... the ids listed by the summary below ... );

UPDATE public.tally_config
   SET is_active = false,
       updated_at = now()
 WHERE COALESCE(is_active, true) = true;


-- What changed, and what the reports will now read from.
SELECT t.id,
       t.company_name,
       CASE WHEN COALESCE(t.is_active, true) THEN 'still ACTIVE' ELSE 'deactivated' END AS state
  FROM public.tally_config t
 ORDER BY state, t.company_name;
