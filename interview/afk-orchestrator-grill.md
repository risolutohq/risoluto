---
sessionID: ses_16eb64dc0ffeXLZ9R39EIE61GN
baseMessageCount: 0
updatedAt: 2026-06-04T09:19:40.638Z
---

# /grill-me ~/Desktop/afk-orchestrator-implementation-plan.md

## Current spec

Global guards added (config-driven max wall-clock + max total sessions; breach halts and journals 'aborted-budget'). Decision: the orchestrator WRITES per-slice status transitions to Linear in real time as the cascade runs — a change from the existing pipeline where /risoluto-sync owns Linear reconciliation after gh pr create. This creates three concerns to pin down: (a) mapping orchestrator statuses (queued/running/coder-incomplete/awaiting-review/merged/rejected/blocked) onto the team's actual Linear workflow states; (b) resilience — a Linear API failure must not break the cascade, so journal stays the source of truth and writes are best-effort/idempotent; (c) avoiding write-fights with /risoluto-sync, which may also flip states/tick ACs from git reality.

## Q&A history

No answers yet.
