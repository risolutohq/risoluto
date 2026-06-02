#!/bin/sh
# PreToolUse(Bash) guard for the Risoluto pipeline's deterministic "never" invariants.
# Pipeline skills PRINT `gh pr create` and never run it; the cascade never force-pushes and
# never skips git hooks. This hook makes those rules deterministic by DENYING the agent's tool
# call (with a reason) so the action becomes the operator's explicit terminal command. It governs
# the agent only — Omer's own terminal is unaffected.
#
# Patterns are anchored to a command position (start of line or after a shell separator ; & | ( )
# so the same strings appearing inside a quoted commit message / echo / heredoc do NOT trip the
# guard.
cmd=$(cat | jq -r '.tool_input.command // ""' 2>/dev/null) || cmd=""

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s (.claude/hooks/guard-pipeline.sh)"}}\n' "$1"
  exit 0
}

matches() { printf '%s\n' "$cmd" | grep -Eq "$1"; }

# gh pr create / gh pr merge at a command position
if matches '(^|[;&|(])[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|merge)([[:space:]]|$)'; then
  deny "Risoluto invariant: pipeline skills PRINT gh pr create and never run it — opening or merging a PR is the operator action. Print the command for Omer to run."
fi

# git push ... --force / -f / --force-with-lease
if matches '(^|[;&|(])[[:space:]]*git[[:space:]]+push([[:space:]]|$)' && matches '(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$))'; then
  deny "Risoluto invariant: never force-push. Rework the branch or hand the command to Omer."
fi

# Note: skipping git hooks (the --no-verify flag) stays a documented convention rather than a hook
# guard — as a bare flag token it cannot be distinguished from a prose mention without false
# positives. The SessionStart reminder carries it.

exit 0
