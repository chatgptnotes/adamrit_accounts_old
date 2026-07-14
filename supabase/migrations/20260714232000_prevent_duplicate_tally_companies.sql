-- Keep one active Tally configuration per canonical company name.
-- Archived duplicate rows retain their IDs and all related synced data.
BEGIN;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g')
      ORDER BY
        CASE WHEN is_active IS NOT FALSE THEN 0 ELSE 1 END,
        last_sync_at DESC NULLS LAST,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id
    ) AS company_rank
  FROM public.tally_config
  WHERE regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') <> ''
)
UPDATE public.tally_config AS config
SET is_active = false,
    auto_sync_enabled = false,
    updated_at = now()
FROM ranked
WHERE config.id = ranked.id
  AND ranked.company_rank > 1
  AND config.is_active IS DISTINCT FROM false;

CREATE UNIQUE INDEX IF NOT EXISTS tally_config_active_canonical_name_uidx
ON public.tally_config (
  regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g')
)
WHERE is_active IS NOT FALSE
  AND regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') <> '';

COMMIT;
