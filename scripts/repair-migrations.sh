#!/bin/bash
# Marks all local-only migrations as applied in the remote migration history.
# Metadata-only: runs no SQL against the schema. One-time repair so that
# `supabase db push` works again. Regenerate the list first in case it changed.
set -u
cd "$(dirname "$0")/.."

supabase migration list --linked 2>/dev/null \
  | awk -F'|' 'NR>2 {gsub(/ /,"",$1); gsub(/ /,"",$2); if ($1 != "" && $2 == "") print $1}' \
  | sort -u > /tmp/local-only-migrations.txt

total=$(wc -l < /tmp/local-only-migrations.txt | tr -d ' ')
echo "Repairing $total migrations..."
ok=0; fail=0
while read -r v; do
  if supabase migration repair --status applied "$v" >/dev/null 2>&1; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "FAILED: $v"
  fi
done < /tmp/local-only-migrations.txt
echo "repaired=$ok failed=$fail"
echo "Verify with: supabase migration list --linked"
