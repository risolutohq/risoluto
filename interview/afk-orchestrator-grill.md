---
sessionID: ses_16eb64dc0ffeXLZ9R39EIE61GN
baseMessageCount: 0
updatedAt: 2026-06-04T10:59:27.325Z
---

# /grill-me ~/Desktop/afk-orchestrator-implementation-plan.md

## Current spec

All high-risk branches resolved. Final design: @opencode-ai/sdk + opencode serve gated by a Wave-0 spike; gate.ts runs the 6 pnpm steps directly with scripts/afk-orchestrator added to build+typecheck; merges serialized via a mutex in a dedicated integration worktree (no repoRoot checkout); permissions honor CONTROL.md require_approval_for with an awaiting-approval state; dag.ts reads Linear via GraphQL (LINEAR_API_KEY); coder/reviewer/diagnoser models are config-only with no defaults and fail-fast; done = idle AND new commit on slice branch; blocked/rejected slices transitively block dependents and halt the cascade at wave end; global wall-clock + total-session guards journal aborted-budget on breach. Largest scope change: the orchestrator now fully replaces /risoluto-sync — live per-slice status writeback plus proof-only AC ticking, with a boot/end reconcile pass re-deriving state from journal+git and Linear writes kept non-fatal. Net-new work beyond the original 12 items: the Wave-0 spike, tsconfig coverage, a real gate runner, a read+write Linear GraphQL layer with proof-only AC engine and reconcile, integration-worktree merge mutex, approval-allowlist wiring, and budget guards. No further high-value questions remain.

## Q&A history

Q: Since the orchestrator now writes per-slice status to Linear in real time, what's the writeback contract — status mapping, failure handling, and coexistence with /risoluto-sync?
A: Write status transitions AND tick acceptance criteria live, fully replacing /risoluto-sync

Q: Now that the orchestrator replaces /risoluto-sync (live status + AC ticking), how does it tick ACs safely and repair Linear drift with no external reconciler left as a backstop?
A: Inherit /risoluto-sync's proof-only rule (tick a criterion only with a git/test citation, never invent Done) AND add a Linear reconcile pass on boot+end that re-derives each issue's state from journal+git and repairs drift; Linear writes stay non-fatal to the cascade (Recommended)
