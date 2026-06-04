#!/usr/bin/env bash
# Stop hook: if there are uncommitted .ts/.tsx changes in the working tree,
# surface oxlint output + a typecheck reminder. Silent when nothing changed.
set -u

# Drain stdin (Stop payload — not used).
cat >/dev/null 2>&1 || true

# Repo root = cwd of the hook (Claude Code runs hooks with cwd = workspace root).
ts_files=$(git diff --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' 2>/dev/null | head -50)
if [ -z "$ts_files" ]; then
  exit 0
fi

file_count=$(printf '%s\n' "$ts_files" | wc -l | tr -d ' ')
reminder="$file_count uncommitted TypeScript file(s) in working tree. Run \`pnpm run typecheck\` before commit."

if [ -x ./node_modules/.bin/oxlint ]; then
  lint_out=$(printf '%s\n' "$ts_files" | xargs -r timeout 30 ./node_modules/.bin/oxlint 2>&1 | tail -60)
  if [ -n "$lint_out" ]; then
    msg=$(printf '%s\n\nOXLint output (modified files):\n%s' "$reminder" "$lint_out")
  else
    msg="$reminder"
  fi
else
  msg="$reminder (skipped lint: node_modules/.bin/oxlint not found — run \`pnpm install\`.)"
fi

jq -n --arg m "$msg" '{systemMessage: $m, suppressOutput: true}'
