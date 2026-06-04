---
name: risoluto-sync
description: Reconcile Linear to git reality for one PRD slug — the Risoluto pipeline's memory-layer repair pass. Use when Omer says /risoluto-sync, "sync linear", "reconcile the tracker", "why is RIS-123 still Todo when it's merged", "tick the acceptance criteria from the merged code", "report linear drift for <slug>", or after an integration/<slug> branch reaches master. For each from:prd-<slug> issue it reads git (is the issue's branch merged?) plus the issue's acceptance criteria, then — proof-only — flips a merged issue to Done, ticks the criteria it can point at, posts one idempotent back-comment, and reports every remaining drift (Done-with-empty-ACs, merged-but-Todo, ticked-without-proof, discovered issues orphaned from the wave map). It never invents Done, never edits code or git history, never opens a PR. Idempotent. Stage 4.5 of docs/research-to-shipping-pipeline.md.
---

# risoluto-sync

The Linear **reconciler**. Linear is the pipeline's shared memory layer, but the only writers that
keep it current — the AFK conductor's merge agent and `/risoluto-tdd` Step 5 — are model actions that
silently fail (a Linear hiccup, a skipped step, a goal run that halted). The result is drift: issues
whose code is merged but whose status is still `Todo`, acceptance boxes never ticked, `discovered`
issues orphaned from the frozen wave map. This skill repairs that drift from **git truth + proof**,
and reports what it cannot safely repair.

It is bookkeeping reconciliation, not code review. (`/risoluto-review-handoff` is the different-model
_code_ review over the whole integration branch; this skill never judges code — only whether Linear
matches git.)

> **Linear access (agent-portable).** Bind each Linear **operation** to your surface — under Claude
> the Linear MCP tools (`mcp__linear-server__<op>`), under Codex `LINEAR_API_KEY` + GraphQL. The
> concrete queries (`list issues by label`, `get issue`, `resolve workflow-state id`, `issueUpdate`,
> `commentCreate`) live in [`../references/linear-access.md`](../references/linear-access.md). If Linear
> is unreachable, surface the error verbatim and stop — never retry auth.

## What this skill does (per `<slug>`)

1. Reads every `from:prd-<slug>` issue (status, description + `## Acceptance criteria`, git branch name,
   blocked-by, labels) and the PRD `docs/prds/<slug>.md`.
2. Establishes git truth: for each issue, is its branch merged into `integration/<slug>` (or the
   default branch)? — `git branch --merged` / `git log --merges`.
3. **Proof-only reconciliation** (writes only what git + a citable test/entry point support):
   - Flip an issue to **Done** iff its branch is merged AND its provable acceptance criteria are ticked.
   - Tick a criterion `- [ ]` → `- [x]` iff a test or production entry point added in the issue's merged
     code actually proves it; append the proof pointer (the same rule as `/risoluto-tdd` Step 5.6).
   - Post one **idempotent** back-comment (marker convention below).
4. **Drift report** (the primary output) — everything it did _not_ safely repair, so the founder disposes.

## Hard preconditions

| Check              | Verification                                  | If it fails                                               |
| ------------------ | --------------------------------------------- | --------------------------------------------------------- |
| Run from repo root | `test -f package.json && test -f .gitmodules` | Tell Omer to `cd` into the Risoluto checkout root.        |
| Slug provided      | argv has `<slug>`                             | Ask Omer for the PRD slug.                                |
| PRD exists         | `docs/prds/<slug>.md` exists                  | Run `/risoluto-to-prd <slug>` first.                      |
| Linear reachable   | connectivity probe succeeds                   | Surface the error verbatim; do not retry auth.            |
| Issues exist       | `from:prd-<slug>` label returns ≥1 issue      | Run `/risoluto-to-issues <slug>` first — nothing to sync. |

## Pipeline

### Step 1 — Gather Linear + git state

- List `from:prd-<slug>` issues; for each capture `id`, `identifier`, `status`, `gitBranchName`,
  `labels`, `blockedBy`, and the `## Acceptance criteria` block from the description.
- Resolve the team's `Done` workflow-state id (linear-access.md → resolve a workflow-state id).
- `git fetch origin`. Determine the reconcile target branch: `integration/<slug>` if it exists, else
  the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`).
- For each issue, decide **merged?** — its `gitBranchName` (or any `feat*/<slug>` branch for the issue)
  appears in `git branch --all --merged <target>`, or a merge commit references it.

### Step 2 — Classify each issue against git truth

| Class               | Condition                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| `merged-proven`     | branch merged AND every load-bearing AC is provable from the diff      |
| `merged-unproven`   | branch merged but ≥1 AC cannot be pointed at (stub / exported-unwired) |
| `built-not-merged`  | `In Progress`, branch exists, not merged into target                   |
| `not-started`       | `Todo`/`Backlog`, no branch / unmerged                                 |
| `discovered-orphan` | label `discovered`, not present in `~/.risoluto/goals/<slug>/WAVES.md` |

### Step 3 — Reconcile (proof-only — never invent Done)

- `merged-proven` → if status ≠ Done, `issueUpdate` to the Done state; tick each provable AC with its
  proof pointer; post the idempotent merge back-comment.
- `merged-unproven` → leave status untouched; tick only the provable ACs; **report** the unprovable
  ones as drift (these are reachability/test-honesty gaps — the `verification-ladder` bar).
- `built-not-merged`, `not-started`, `discovered-orphan` → never write status; **report** only.
- **Never** flip a `Todo`/`Backlog` issue to Done from a green suite alone, and never tick a box you
  cannot cite — green proves the unit, not that the operator can reach the behaviour.

### Step 4 — Idempotent comments (the marker convention)

Every automated Linear comment a pipeline skill or script posts begins with an HTML marker
`<!-- risoluto:<kind>[:<key>] -->` (e.g. `<!-- risoluto:sync:PR-10 -->`, `<!-- risoluto:merged:PR-10 -->`).
Before `commentCreate`, list the issue's comments and **skip** if one with the same marker already
exists. This is what makes re-runs safe (`commentCreate` has no native dedup). `scripts/post-merge-prd.mjs`
follows the same convention.

### Step 5 — Emit the drift report

Print a table the founder can act on, plus a one-line summary:

```
slug: <slug>  target: integration/<slug>  reconciled: <N> Done, <M> ACs ticked, <K> comments
DRIFT (founder disposes):
  RIS-212  merged-unproven   2/4 ACs unprovable: status-projection mapping has no non-test caller
  RIS-218  merged-proven     flipped Todo → Done; ticked 3/3 ACs
  RIS-222  discovered-orphan not in WAVES.md — re-run /risoluto-goal-prep to fold it into a wave
```

## Invariants & notes

- **Git is canon; Linear mirrors.** This skill only writes Linear status / AC ticks / comments, and
  only with git + proof evidence behind each write. It never edits code, git history, or the PRD.
- **Never invent Done.** A merged branch with unprovable ACs stays as-is and is reported, not closed.
- **Idempotent.** Re-runs re-derive state and re-skip already-present comments; status/AC writes are
  no-ops when already correct. Safe to run repeatedly.
- **No PR, no push.** Reporting and Linear writes only. It prints; it never runs `gh pr create`.
- **Discovered-issue re-entry is a report, not an action.** Orphaned `discovered` issues are surfaced
  so the operator re-runs `/risoluto-goal-prep <slug>` to re-freeze the wave map including them — this
  skill does not edit `WAVES.md`.
- **Default the team to `Ninetech`.** Only one team exists; do not ask.

## Companion files

- `../references/linear-access.md` — the concrete Linear operations (status flip, comment, list-by-label).
- `scripts/post-merge-prd.mjs` — the CI back-comment writer that shares the marker convention.
- `skills/risoluto-tdd/` — owns the per-ticket AC reconciliation at PR-open; this skill is the backstop
  that repairs what that step (or the AFK merge agent) left undone.
- `skills/risoluto-review-handoff/` — the different-model _code_ review (distinct from this bookkeeping pass).
- `docs/research-to-shipping-pipeline.md` — the Linear memory-layer contract this skill enforces.
