---
name: risoluto-pre-pr
description: Risoluto Stage 3.5 advisory pre-PR review — the per-ticket review/cleanup pass that runs after `/risoluto-tdd` and before `gh pr create`. Use when Omer says `/risoluto-pre-pr`, "run the advisory review", "prep this branch for the PR", "stage 3.5", "review before I open the PR", or "review and tidy my changes". Orchestrates four existing tools in order — `/code-review` (read-only; surfaces correctness bugs, operator triages), applies the fixes the operator approves, `/simplify` (quality cleanup — reuse/simplification/efficiency/altitude), then a MANDATORY `/v1-check` whenever any code changed — and finally PRINTS (never runs) the `gh pr create` command. Advisory, not a blocking gate — the founder applies findings selectively (skills propose; the founder disposes). Touches no tracker state — labels, back-comments, and acceptance-criteria reconciliation stay `/risoluto-tdd`'s job after the PR opens. Do NOT trigger on a bare `/code-review` or `/simplify` (the generic skills this wraps), and do NOT treat it as a blocking gate. Stage 3.5 of `docs/research-to-shipping-pipeline.md`.
---

# risoluto-pre-pr

Stage 3.5 of the Risoluto research → shipping pipeline. The advisory review/cleanup pass an operator runs on a finished ticket branch — after `/risoluto-tdd` has implemented, committed, pushed, and **printed** `gh pr create`, but before that command is actually run. It is a quality and correctness checkpoint, **not** a blocking gate: the founder applies findings selectively (architecture principle #9 — _skills propose; the founder disposes_).

It is new orchestration, not a fork — it sequences three tools that already exist (`/code-review`, `/simplify`, `/v1-check`) and adds the one guard that is easy to forget by hand: a mandatory verification run after `/simplify` rewrites the diff.

> **Skill access (agent-portable).** This skill names review **operations**, not fixed tools — bind each to your agent's surface, invoking it through your agent's skill mechanism (the Skill tool under Claude):
>
> - **bug-review** → under Claude, the `/code-review` skill; under Codex, `~/.codex/skills/code-review`.
> - **quality-cleanup** → under Claude, the built-in `/simplify` skill. **Codex has no quality-only simplify** (its `simplify` aliases code-review), so under Codex apply the four cleanup lenses (reuse, simplification, efficiency, altitude) by hand against the diff, or defer this step to the operator on Claude. State which you did.
> - **verification gate** → `/v1-check` (symlinked into both `.claude/skills/` and `.agents/skills/`, so both harnesses have it).
>
> If a bound surface is unavailable, say so and continue with the steps you can run — but **never silently skip the verification gate**.

## What this skill does

On the current branch's diff:

1. Runs a **read-only** bug review and ranks the findings.
2. Lets the operator decide which findings to fix (the advisory gate), then applies only those.
3. Runs the **quality-cleanup** pass, which applies reuse/simplification/efficiency/altitude fixes directly.
4. If anything changed in steps 2–3, runs the **MANDATORY** `/v1-check` gate and stops on failure.
5. Commits + pushes the review/cleanup, then **prints** (never runs) the `gh pr create` command.

It never writes to the tracker — applying the `from:prd-<slug>` label, back-commenting the Linear ticket, and reconciling acceptance criteria are `/risoluto-tdd` Step 5, which runs after the operator opens the PR. No duplication.

## Hard preconditions

| Check                           | Command / verification                                                                   | If it fails                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Run from repo root              | `test -f package.json && test -f .gitmodules`                                            | Tell Omer to `cd` into the `risoluto` checkout root.                            |
| Branch has a reviewable diff    | `git diff @{upstream}...HEAD` (→ `main...HEAD`/`HEAD~1`) or `git diff HEAD` is non-empty | Nothing to review — tell Omer there are no changes on this branch.              |
| Not a bare default branch       | current branch is a feature/ticket branch, not `master` with an empty diff               | Stage 3.5 runs on the ticket branch; switch to it first.                        |
| Bound review surfaces reachable | the bug-review, quality-cleanup, and gate skills resolve for this agent                  | Surface which is missing; run the steps you can — never skip the gate silently. |

## Pipeline

### Step 1 — Bug review (read-only)

Invoke the **bug-review** operation against the current diff at effort `high` (recall-biased — it adds the cross-file tracer angle that catches exported-but-unwired code, the repo's known reachability gap; the operator may pass a different effort, e.g. `xhigh`/`max` for a large or risky diff). The review is read-only — it returns a ranked findings list and changes nothing. If it returns no findings, record "no correctness findings" and continue to Step 3.

### Step 2 — Triage & fix (the advisory gate)

Present the findings and let the operator decide what to fix — this is the _founder disposes_ gate. Under Claude, use `AskUserQuestion` to offer the findings (multi-select) plus an explicit "fix none"; other agents stop and wait for an explicit list. Apply **only** the approved fixes. For each finding you skip, note it in the final summary (one line, with the reason) rather than arguing it. Never auto-apply a fix the operator did not pick — `/code-review` is advisory, not authoritative.

### Step 3 — Quality cleanup

Invoke the **quality-cleanup** operation (`/simplify`) against the diff. It applies reuse/simplification/efficiency/altitude fixes directly and reports what it changed and skipped — relay that summary. (Codex: no quality-only simplify — apply the four lenses by hand, or tell the operator this step needs Claude.) If the operator wants no cleanup, this step is skippable on request — say so explicitly.

### Step 4 — MANDATORY verification

If Steps 2 or 3 changed any file, run the **verification gate** (`/v1-check`): build → lint → format:check → test → typecheck → typecheck:coverage. **This is non-negotiable** — `/simplify` rewrites code and never re-verifies, so skipping the gate is exactly how a green-looking branch ships broken. If the gate fails, **STOP**: surface the failing step's output verbatim, do **not** print the PR command, and hand the failure back to the operator. If nothing changed in Steps 2–3, the prior gate result still holds — note that instead of re-running.

### Step 5 — Commit, push, print the PR command

Only when the gate is green **and** code changed:

1. Commit the work as conventional commit(s) on the current branch — pick a scope from the repo's commitlint enum (e.g. `fix(<scope>): …` for an applied bug finding, `refactor(<scope>): …` for cleanup). Keep applied bug fixes and pure cleanup in separate commits when both happened.
2. Push the branch.
3. **PRINT** the `gh pr create` command — targeting `integration/<prd-slug>` when the branch came from `/risoluto-tdd`, else the upstream/default branch — for the operator to run. **Do NOT execute `gh pr create`.**

If no code changed (clean review, no cleanup applied), say so and just reprint the `gh pr create` command `/risoluto-tdd` already produced — no new commit.

## Notes for the agent

- **Advisory, never blocking.** Surface findings and let the operator choose. This stage does not gate the PR — it informs it.
- **Print, never run `gh pr create`.** Matches `/risoluto-to-prd` and `/risoluto-tdd`. Opening the PR is always the operator's action.
- **The mandatory `/v1-check` after cleanup is the load-bearing guard** — it is the whole reason Stage 3.5 is a skill and not a doc note. Never reach Step 5 over a red or unrun gate.
- **No tracker writes.** The Linear label, back-comment, and acceptance-criteria reconciliation belong to `/risoluto-tdd` Step 5, after the PR opens. Don't duplicate them here.
- **Default the bug-review to `high`** specifically to catch the reachability gap (exported-but-unwired code that passes the unit gate). Bump to `xhigh`/`max` for large or cross-cutting diffs.

## Companion files

- `docs/research-to-shipping-pipeline.md` — the Stage 3.5 spec
- `/code-review`, `/simplify`, `/v1-check` — the three tools this skill orchestrates
- `skills/risoluto-tdd/` — Stage 3 upstream; produces the branch this reviews and owns the Linear writes after the PR opens
- `skills/risoluto-verify-acceptance/` — the cross-model companion to this same-model pass; recommended before `gh pr create` (a different model verifies each acceptance criterion; `NOT_MET` blocks)
- `skills/risoluto-review-handoff/` — the AFK end-review analog (a reviewer-only pass over the finished `integration/<slug>` branch)
