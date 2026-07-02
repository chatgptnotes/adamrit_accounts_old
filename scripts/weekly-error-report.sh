#!/bin/bash
# Weekly Supabase Postgres error report for drmhope (xvkxccqaopbnkvwgyfjv).
# Aggregates the last 7 days of ERROR/FATAL/PANIC log events by message and
# writes a dated markdown report + macOS notification.
# Config: ~/.config/adamrit-error-report/env  (created by the installer)
set -euo pipefail

PROJECT_REF="xvkxccqaopbnkvwgyfjv"
CONFIG="$HOME/.config/adamrit-error-report/env"
OUT_DIR="$HOME/adamrit-error-reports"
mkdir -p "$OUT_DIR"

# shellcheck disable=SC1090
source "$CONFIG"   # provides SUPABASE_ACCESS_TOKEN

SQL="select event_message, parsed.error_severity, count(*) as cnt from postgres_logs cross join unnest(metadata) as m cross join unnest(m.parsed) as parsed where parsed.error_severity in ('ERROR','FATAL','PANIC') group by event_message, parsed.error_severity order by cnt desc limit 25"
ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$SQL")
START=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ")

REPORT="$OUT_DIR/$(date +%Y-%m-%d).md"

curl -sf "https://api.supabase.com/v1/projects/$PROJECT_REF/analytics/endpoints/logs.all?sql=$ENC&iso_timestamp_start=$START" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | python3 - "$REPORT" <<'PY'
import json, sys
resp = json.load(sys.stdin)
rows = resp.get("result", [])
total = sum(r.get("cnt", 0) for r in rows)
lines = ["# Postgres error report — last 7 days", "",
         f"Total errors (top 25 messages): **{total}**", "",
         "| Count | Severity | Message |", "|---|---|---|"]
for r in rows:
    msg = str(r.get("event_message", "")).replace("|", "\\|")[:160]
    lines.append(f"| {r.get('cnt')} | {r.get('error_severity')} | {msg} |")
if not rows:
    lines.append("| 0 | — | no errors logged |")
open(sys.argv[1], "w").write("\n".join(lines) + "\n")
print(total)
PY

TOTAL=$(sed -n '3p' "$REPORT" | grep -oE '[0-9]+' || echo "?")
osascript -e "display notification \"${TOTAL} Postgres errors in the last 7 days. Report: ${REPORT}\" with title \"Adamrit weekly error report\"" || true
echo "Report written: $REPORT (total: $TOTAL)"
