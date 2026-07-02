#!/bin/bash
# One-time installer for the weekly Supabase error report.
# 1. Finds (or asks for) a Supabase access token and validates it.
# 2. Saves it to ~/.config/adamrit-error-report/env (chmod 600).
# 3. Installs a launchd agent that runs every Monday at 09:07 local.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="$HOME/.config/adamrit-error-report"
PLIST="$HOME/Library/LaunchAgents/com.adamrit.error-report.plist"

validate() {
  curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $1" https://api.supabase.com/v1/projects
}

TOKEN=""
for name in "Supabase CLI" "supabase" "supabase_cli"; do
  t=$(security find-generic-password -l "$name" -w 2>/dev/null || true)
  if [ -n "$t" ] && [ "$(validate "$t")" = "200" ]; then TOKEN="$t"; break; fi
done
if [ -z "$TOKEN" ] && [ -f "$HOME/.supabase/access-token" ]; then
  t=$(cat "$HOME/.supabase/access-token")
  [ "$(validate "$t")" = "200" ] && TOKEN="$t"
fi
if [ -z "$TOKEN" ]; then
  echo "No working token found in keychain. Create a personal access token at:"
  echo "  https://supabase.com/dashboard/account/tokens"
  read -r -p "Paste token (sbp_...): " TOKEN
  [ "$(validate "$TOKEN")" = "200" ] || { echo "Token failed validation. Aborting."; exit 1; }
fi
echo "Token validated."

mkdir -p "$CONFIG_DIR"
umask 077
printf 'SUPABASE_ACCESS_TOKEN=%s\n' "$TOKEN" > "$CONFIG_DIR/env"
echo "Saved to $CONFIG_DIR/env (mode 600)."

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.adamrit.error-report</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/weekly-error-report.sh</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>7</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/adamrit-error-report.log</string>
  <key>StandardErrorPath</key><string>/tmp/adamrit-error-report.log</string>
</dict></plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed launchd job (Mondays 09:07). Running once now to verify..."
bash "$REPO_DIR/scripts/weekly-error-report.sh"
