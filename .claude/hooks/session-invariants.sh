#!/bin/sh
# SessionStart: surface the Risoluto pipeline's deterministic non-negotiables and the back-half
# skill map so every session starts with them in context (complements AGENTS.md; names the guards
# and the newest skills an agent must not violate or overlook).
cat <<'EOF'
Risoluto pipeline non-negotiables (deterministic context):
- Git is canon for PRDs; Linear mirrors. Slug is the join key across roadmap <!-- slug:X -->, PRD filename, prd.slug frontmatter, and the from:prd-<slug> Linear label. `pnpm slug:check` enforces it.
- Skills PRINT the PR command; never run it. No force-push. (A PreToolUse hook blocks auto-PR and force-push for the agent.) Never skip git hooks (--no-verify).
- Acceptance criteria are the red-test spec; tick a box only from proof (a cited test or production entry point), never from a green suite. A green gate is not reachability.
- Not idempotent: to-issues, tdd — reconcile before re-running.
- Back-half: /risoluto-preflight (roadblocker gate) -> /risoluto-goal-prep (sole renderer) -> /risoluto-goal-run (runner; a stuck issue halts the cascade and journals the blocker) -> /risoluto-review-handoff (goal-level cross-model review). Per-issue cross-model AC check: /risoluto-verify-acceptance. Linear memory repair: /risoluto-sync.
EOF
