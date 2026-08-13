#!/usr/bin/env bash
# PreToolUse/Bash hook: refuse `git push` while origin/main has commits we don't have.
# Forces the commit -> pull --rebase -> push -> deploy order.
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Only care about real pushes (skip --dry-run and anything that isn't a push).
case "$cmd" in
  *"git push"*) ;;
  *) exit 0 ;;
esac
case "$cmd" in
  *--dry-run*) exit 0 ;;
esac

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

git fetch origin main --quiet 2>/dev/null || exit 0

behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
[ "$behind" -eq 0 ] 2>/dev/null && exit 0

jq -n --arg n "$behind" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("origin/main is \($n) commit(s) ahead of your HEAD. Run `git pull --rebase origin main` first (resolve any conflicts, never force-push), then push, then verify the Vercel deploy. See the commit-pull-push-deploy skill.")
  }
}'
exit 0
