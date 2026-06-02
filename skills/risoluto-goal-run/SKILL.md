---
name: risoluto-goal-run
description: Claude-native AFK conductor — RUNS a goal package (rendered by /risoluto-goal-prep) as a wave cascade using the Workflow tool; auto-renders the package if missing, so /risoluto-goal-run <slug> works on its own. Use for /risoluto-goal-run <slug>, "run the goal in Claude", "drive the waves", "conduct the build", or executing a prepared ~/.risoluto/goals/<slug>/ package without Codex. Waves run sequentially; independent ready issues within a wave are built in parallel in isolated git worktrees and merged up to integration/<slug>; the run is journaled and resumable. Invoking this skill is the explicit opt-in to multi-agent orchestration. The conductor never opens a PR — it prints gh pr create. Sibling of the Codex /goal launch; both consume the same package.
---

# risoluto-goal-run

The **Claude-native runner** for a goal package. Where `/risoluto-goal-prep` _generates_ the package and
Codex `/goal` is _one_ way to run it, this skill is the _other_ way: it drives the wave cascade from inside
Claude Code using the **`Workflow` tool** for deterministic control flow + parallel agent fan-out.

This is strictly better than the "paste `GOAL.md` into a plain Claude session" fallback: independent
issues within a wave build **in parallel** (each in its own worktree), and the run is **journaled and
resumable**. It auto-renders the package on demand (Step 0) and then runs it, so `/risoluto-goal-run <slug>`
is enough on its own — `/risoluto-goal-prep` stays available to generate or inspect the package separately.

The package at `~/.risoluto/goals/<slug>/` stays the single source of truth. This skill does not
re-plan it; it faithfully executes `WAVES.md` under the constraints in `GOAL.md`.

## Contract

- **Topology (fixed):** `integration/<slug>` → one `wave/<n>-<slug>` branch per wave → per-issue
  worktrees off the wave branch → merge issue → wave → integration. The next wave branches from the new
  integration tip. Never branch a wave or issue off `master`.
- **Waves are sequential; issues within a wave are parallel.** A wave is drained in rounds: each round
  builds the currently-ready issues (blockers Done) in parallel, merges the green ones serially, then
  recomputes the ready-set. Repeat until the wave is empty.
- **The Workflow script orchestrates; agents do the work.** A Workflow script has no shell or
  filesystem access — it can only spawn agents and pass data between them. So **all git, implementation,
  and merges are performed by agents**; the script holds the wave loop, the parallel fan-out, and the
  gates. Wave/issue data is passed in via `args` (the script cannot read `WAVES.md` itself).
- **Do NOT use the Workflow tool's `isolation: 'worktree'`** — it spawns throwaway worktrees off
  `master`, which breaks the cascade topology (this has burned us before). Agents create explicit
  worktrees off the wave branch instead.
- **Memory split:** issue status in Linear, code in git, process state in `~/.risoluto/goals/<slug>/`.
- **A green gate is not reachability.** `/v1-check` green proves modules compile and unit tests hold,
  not that any capability runs from a real entry point. The end-review (`/risoluto-review-handoff`)
  exists to catch features wired only in tests; treat all-green as necessary, not sufficient.
- **Print-only PR.** The conductor prints `gh pr create`; it never runs it.
- **Hard stops:** gate red after one repair, a merge conflict needing ownership judgment, missing
  credentials, an ADR/PRD conflict, a destructive/dependency change needing approval, or budget
  exhaustion. On a hard stop, the agent records the blocker in `PLAN.md`/`ATTEMPTS.md` and the cascade
  halts at that wave.

## Preconditions

Stop and report the exact failure if any check fails.

| Check               | Verification                                                                          | Failure path                                                   |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Repo root           | `test -f package.json && test -f .gitmodules`                                         | Run from the Risoluto checkout.                                |
| Package renderable  | `docs/prds/<slug>.md` has `linear_project`, and `from:prd-<slug>` Linear issues exist | Run `/risoluto-to-prd` + `/risoluto-to-issues <slug>` first.   |
| Clean base          | `git status --short` is clean (or only expected files)                                | Commit/stash first — a dirty base contaminates the cascade.    |
| Linear reachable    | `LINEAR_API_KEY` GraphQL probe succeeds, or Linear MCP is available                   | Surface the error; do not retry auth.                          |
| Claude Code runtime | the `Workflow` tool is available in this session                                      | This skill is Claude-only; use the Codex `/goal` path instead. |

Launch from a **clean checkout of the base branch** (usually `master`), not from an unrelated feature
worktree — the cascade creates `integration/<slug>` and the wave/issue branches beneath it.

## Pipeline

### Step 0 — Ensure the package (auto-render)

This runner is self-sufficient — it renders the package itself, so a separate `/risoluto-goal-prep` call is
optional. If `~/.risoluto/goals/<slug>/GOAL.md` is missing, or you want a fresh plan after milestone/issue
changes, render it with the shared generator:

```bash
node skills/risoluto-goal-prep/scripts/render.mjs <slug> --force
```

(That is exactly what `/risoluto-goal-prep` runs — the runner calls the generator as a library.) To inspect
or hand-tune the frozen plan before building, run `/risoluto-goal-prep <slug>` and review `WAVES.md` first;
otherwise this step makes `/risoluto-goal-run <slug>` enough on its own.

### Step 1 — Assemble `args` from the package + live Linear

The Workflow script cannot read files, so gather everything it needs first:

1. Read `~/.risoluto/goals/<slug>/WAVES.md` for the frozen wave→issue map and `integration_branch`.
2. Refresh the live ready-set from Linear (issue states + `blocked-by`) for label `from:prd-<slug>` —
   `WAVES.md` is the frozen map, but blocker _state_ is read live.
3. Build the `args` object the conductor expects:

```jsonc
{
  "slug": "<slug>",
  "repoRoot": "<abs repo root>",
  "goalDir": "/home/<user>/.risoluto/goals/<slug>",
  "baseBranch": "master",
  "integrationBranch": "integration/<slug>",
  "waves": [
    {
      "number": 1,
      "name": "<wave name>",
      "branch": "wave/1-<wave-slug>",
      "issues": [{ "id": "NIN-225", "title": "...", "branch": "feature/nin-225-...", "blockedBy": [] }],
    },
  ],
}
```

`blockedBy` lists only blockers; the conductor treats a blocker outside the current wave as already
satisfied (earlier waves merged before this one starts).

### Step 2 — Launch the conductor Workflow

Invoke the `Workflow` tool with the bundled script and the `args` from Step 1:

```
Workflow({ scriptPath: "skills/risoluto-goal-run/references/conductor.workflow.mjs", args })
```

(If `scriptPath` to a repo file is unavailable, read the file and pass its contents as `script`.) The
conductor runs the wave loop, fanning out ready issues each round and serially merging the green ones.
Watch progress with `/workflows`. It returns a summary `{ waves: [...], allWavesMerged, readyForReview }`.

**Resume:** if the run is paused, killed, or you edit the script, relaunch with
`Workflow({ scriptPath, args, resumeFromRunId: "<prior runId>" })`. Cached agent results return
instantly; only new/edited steps re-run. Agents always reconcile from git + Linear + `PLAN.md` before
acting, so a resumed cascade never double-builds a merged issue.

### Step 3 — End-review, fix, and print the PR

This stays in the main loop (the reviewer must be a _different model_ from the build agents):

1. When the conductor returns `readyForReview: true`, run `/risoluto-review-handoff <slug>` —
   it writes `~/.risoluto/goals/<slug>/REVIEW.md` and a Linear comment.
2. Ingest `REVIEW.md`. Fix every open **HIGH** finding on `integration/<slug>` (a focused agent or a
   small follow-up Workflow), committing the fixes — do not leave PR-relevant code only in the working
   tree.
3. Re-run `/v1-check` on `integration/<slug>` (plus `pnpm run test:integration` if a fix touched an
   integration boundary). Confirm `git status --short` is clean and `REVIEW.md` has no open HIGH.
4. **Print** the `gh pr create --base master --head integration/<slug> ...` command. Do not run it.

If the conductor returned `allWavesMerged: false`, stop at Step 3 — report which wave blocked and why
(from `PLAN.md`), and do not proceed to the PR.

## Git / env rules the agents follow (baked into the conductor prompts)

These are the hard-won operational rules; the bundled script embeds them in every build/merge/gate
agent prompt:

- Prefix every `pnpm` and `git commit` with **`CI=true`** (the no-TTY agent context aborts pnpm
  otherwise). If deps look off in a worktree: `CI=true pnpm install --frozen-lockfile`.
- Create issue worktrees with explicit git off the **wave branch**:
  `git -C <repo> worktree add <repo>/.agent-worktrees/<slug>-<issue> -b <issue-branch> <wave-branch>`.
- Symlink deps into the worktree so tests run: `ln -s <repo>/node_modules <worktree>/node_modules`.
  Do **not** recurse submodules into the worktree (the engine gate does not need `research/`).
- Each build agent edits **only inside its own worktree**; parallel agents never touch a shared tree.
- Merges are **serial** (one merge agent per round); a conflict needing product judgment is a hard stop.
- Remove worktrees when done with `git -C <repo> worktree remove --force <worktree>`.
- Mark a Linear issue Done only **after** its branch merges into the wave branch.

## Output

End with: the package path, waves-merged count (`N/total`), gate status, review status (HIGH count),
the integration branch + final commit, the printed `gh pr create` command, and any blocker.

## Companion Files

- `references/conductor.workflow.mjs` — the bundled `Workflow` script this skill launches.
- `skills/risoluto-goal-prep/` — the generator that produces the package (Phase 4.0).
- `skills/risoluto-review-handoff/` — the different-model end-review (Phase 4.4).
- `skills/risoluto-tdd/` — the per-issue red-green-refactor method the build agents use.
- `docs/research-to-shipping-pipeline.md` — the pipeline this runs the back-half of.
