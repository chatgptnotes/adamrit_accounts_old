#!/bin/bash
# Weekly Supabase Postgres error report for drmhope (xvkxccqaopbnkvwgyfjv).
# Aggregates the last 7 days of ERROR/FATAL/PANIC log events by message and
# writes a dated markdown report + macOS notification.
# Config: ~/.config/adamrit-error-report/env  (created by the installer)
#
# Hardening notes (2026-07-02, first real run):
# - `python3 - <<heredoc` takes stdin for the program text, so the JSON must
#   go through a temp file, never a pipe.
# - The analytics endpoint intermittently returns {"error":"Backend error!"}
#   and spurious {"message":"Unauthorized"} — retry with backoff and only
#   accept a body whose .result is a list.
# - iso_timestamp_start alone proved unreliable; the timestamp filter is also
#   embedded in the SQL as belt and braces.
# - 2026-07-03: the endpoint now permanently rejects cross join unnest(metadata)
#   queries with "Backend error!" — filter on event_message LIKE instead of
#   parsed.error_severity.
set -euo pipefail

PROJECT_REF="xvkxccqaopbnkvwgyfjv"
CONFIG="$HOME/.config/adamrit-error-report/env"
OUT_DIR="$HOME/adamrit-error-reports"
mkdir -p "$OUT_DIR"

# shellcheck disable=SC1090
source "$CONFIG"   # provides SUPABASE_ACCESS_TOKEN

SQL="select event_message, count(*) as cnt from postgres_logs where timestamp > timestamp_sub(current_timestamp(), interval 7 day) and (event_message like '%ERROR%' or event_message like '%FATAL%' or event_message like '%PANIC%' or event_message like '%does not exist%' or event_message like '%invalid input%') group by event_message order by cnt desc limit 25"
ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$SQL")
START=$(date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ")
URL="https://api.supabase.com/v1/projects/$PROJECT_REF/analytics/endpoints/logs.all?sql=$ENC&iso_timestamp_start=$START"

REPORT="$OUT_DIR/$(date +%Y-%m-%d).md"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

ok=""
for attempt in 1 2 3 4 5; do
  http=$(curl -s -o "$TMP" -w "%{http_code}" "$URL" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN") || http="000"
  if [ "$http" = "200" ] && python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
sys.exit(0 if isinstance(d.get('result'), list) else 1)
" "$TMP" 2>/dev/null; then
    ok=1
    break
  fi
  echo "attempt $attempt failed (HTTP $http): $(head -c 120 "$TMP")" >&2
  sleep $((attempt * 15))
done

if [ -z "$ok" ]; then
  osascript -e "display notification \"Logs API kept failing — no report generated. See /tmp/adamrit-error-report.log\" with title \"Adamrit weekly error report\"" || true
  echo "ERROR: logs API failed after 5 attempts" >&2
  exit 1
fi

python3 - "$REPORT" "$TMP" <<'PY'
import json, sys
resp = json.load(open(sys.argv[2]))
rows = resp.get("result") or []
total = sum(r.get("cnt", 0) for r in rows)
lines = ["# Postgres error report — last 7 days", "",
         f"Total errors (top 25 messages): **{total}**", "",
         "| Count | Message |", "|---|---|"]
for r in rows:
    msg = str(r.get("event_message", "")).replace("|", "\\|")[:160]
    lines.append(f"| {r.get('cnt')} | {msg} |")
if not rows:
    lines.append("| 0 | no errors logged |")
open(sys.argv[1], "w").write("\n".join(lines) + "\n")
print(total)
PY

TOTAL=$(sed -n '3p' "$REPORT" | grep -oE '[0-9]+' || echo "?")
osascript -e "display notification \"${TOTAL} Postgres errors in the last 7 days. Report: ${REPORT}\" with title \"Adamrit weekly error report\"" || true
echo "Report written: $REPORT (total: $TOTAL)"
