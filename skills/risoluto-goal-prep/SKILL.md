---
name: risoluto-goal-prep
description: Generate a launchable, runner-agnostic /goal package for a Risoluto PRD — runs under Codex goal-forge or Claude Code. Use for /risoluto-goal-prep <slug>, "make the AFK goal", "generate the conductor goal", or preparing a PRD for autonomous implementation. Derives waves from the PRD Linear project's milestones, writes ~/.risoluto/goals/<slug>/{GOAL.md,SPEC.md,WAVES.md,CONTROL.md,PLAN.md,ATTEMPTS.md,NOTES.md}, reports runner readiness (Codex config when launching under Codex), and prints launch steps for both runners. Does not run the conductor, edit runner config, create PRs, or modify goal-forge.
---

# risoluto-goal-prep

Generate the durable control package for a Risoluto AFK build. The generated `/goal` makes the conductor
agent (Codex goal-forge or Claude Code) both conductor and implementer: it drains Linear issues wave by
wave, uses one cascade integration branch, stops for a different-model end-review, then fixes review
findings and prints the PR command.

This skill is a generator, not the runner. The package is runner-neutral; pick Codex or Claude Code at
launch time. **Rendering is this skill's sole job** — `/risoluto-goal-run` consumes the rendered package and
never re-renders it (a re-render would wipe the conductor's `PLAN.md` / `ATTEMPTS.md` / `NOTES.md` resume
state mid-run), so re-freezing the wave map after milestone/issue changes is always done here.

## Contract

- Topology is deterministic: `integration/<slug>` -> one active `wave/<n>-<slug>` -> per-issue worktrees
  -> wave -> integration. The next wave starts from the current integration tip.
- Waves are Linear project milestones sorted by `sortOrder`.
- Runtime ready-set is live Linear `blocked-by` state; `WAVES.md` is the frozen map, not issue status.
- Memory split: issue status in Linear, code in git, conductor process state in `~/.risoluto/goals/<slug>/`.
- Final PR readiness requires a committed, clean integration branch. Review-fix code must not remain only in
  the working tree when the goal prints the PR command.
- A green gate is not reachability. `pnpm` build/lint/test/typecheck passing proves the modules compile and
  their unit tests hold, not that any capability runs from a real entry point. The capstone wave's NOTES
  evidence must include at least one end-to-end run driven through a production surface (a CLI invocation, a
  signed webhook/Slack request), not a test that hand-composes modules with stubbed role/action/provider
  outputs. Treat "all issues Done + gate green + capstone passes" as necessary, not sufficient — the
  different-model end-review (`risoluto-review-handoff`) exists to catch features that are wired only in tests.
- Hard stops: gate red after one repair attempt, missing credentials, ADR/product conflict, destructive or
  dependency change needing approval, merge conflict requiring ownership judgment, budget exhausted.
- The goal prints `gh pr create`; it does not run it.
- When launching under Codex, this skill reports goal-forge config gaps; it never edits runner config (`~/.codex/config.toml`). Under Claude Code there is no such config to report.

## Runners

The package is runner-neutral. The same `GOAL.md` launches two ways:

- **Codex (goal-forge):** `references/GOAL.template.md` follows the goal-forge block contract
  (`~/.codex/skills/goal-forge/references/goal_prompt_blocks.md`) and embeds the constant cascade workflow in
  `<workflow>`. Do not modify goal-forge for Risoluto behavior. If the prompt contract changes, edit this
  skill's templates and re-render the package.
- **Claude Code:** open Claude Code in the repo and hand it `GOAL.md` — Claude reads the same blocks and
  drives the cascade directly, resuming long runs from the working-memory files. No goal-forge dependency.

The runners are not identical engines: Codex `/goal` is a durable goal loop; Claude Code drives the package
through its main loop plus auto-compaction, with PLAN.md/ATTEMPTS.md/NOTES.md as the resume state.

## Preconditions

Stop and report the exact failure if any check fails.

| Check                   | Verification                                                 | Failure path                                                    |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Repo root               | `test -f package.json && test -f .gitmodules`                | Tell Omer to run from the Risoluto checkout.                    |
| `research/` initialized | `git submodule status research` starts with a space          | Run `/init-research` or `git submodule update --init research`. |
| Slug provided           | `<slug>` argument exists                                     | Ask for the PRD slug.                                           |
| PRD exists              | `docs/prds/<slug>.md` exists                                 | Run `/risoluto-to-prd <slug>` first.                            |
| PRD synced to Linear    | PRD frontmatter has `linear_project`                         | Run `/risoluto-to-prd <slug>` sync first.                       |
| Linear reachable        | `LINEAR_API_KEY` GraphQL viewer/project query succeeds       | Surface the error; do not retry auth.                           |
| Issues exist            | Linear returns milestones/issues or `from:prd-<slug>` issues | Run `/risoluto-to-issues <slug>` first.                         |

Default team is `Ninetech`; do not ask.

## Pipeline

### Step 1 - Render the package

Run the deterministic renderer:

```bash
node skills/risoluto-goal-prep/scripts/render.mjs <slug>
```

If `~/.risoluto/goals/<slug>/` already contains a package, choose the refresh mode deliberately:

```bash
node skills/risoluto-goal-prep/scripts/render.mjs <slug> --force   # regenerate artifacts, KEEP resume state
node skills/risoluto-goal-prep/scripts/render.mjs <slug> --reset   # wipe everything, including resume state
```

- `--force` regenerates the derived artifacts (`GOAL.md`, `SPEC.md`, `WAVES.md`, `CONTROL.md`) but
  **preserves** the cascade resume state (`PLAN.md`, `ATTEMPTS.md`, `NOTES.md`), so a paused
  `/risoluto-goal-run` cascade can still resume. Use this for a routine re-render of a slug that may be
  mid-flight.
- `--reset` wipes the whole package and regenerates all seven files from scratch. Use this only when you
  want to discard an existing run's progress. It prints a stderr warning naming the resume files it removed.

The script:

- reads `docs/prds/<slug>.md`;
- resolves the Linear project from `linear_project`;
- fetches project milestones and issues through `LINEAR_API_KEY` + GraphQL;
- writes `WAVES.md`, `SPEC.md`, `GOAL.md`, `CONTROL.md`, `PLAN.md`, `ATTEMPTS.md`, and `NOTES.md`;
- falls back to one unmilestoned wave only if the project has no milestones;
- refuses to silently overwrite an existing package unless `--force` or `--reset` is passed.

### Step 2 - Inspect the result

Read the generated summary and spot-check:

- `WAVES.md` wave count and issue count match Linear.
- Wave order follows milestone `sortOrder`.
- `GOAL.md` contains the conductor blocks (goal-forge shape) and the cascade in `<workflow>`.
- `CONTROL.md` contains only the live knobs: `paused`, `primary_priority`, `max_runtime_per_step`,
  `require_approval_for`, and `latest_nudge`.

For `workflow-first-afk-mvp`, the expected waves are:

- W1 Foundation: NIN-194, NIN-195
- W2 Skeleton: NIN-196, NIN-197, NIN-198, NIN-199
- W3 Engine: NIN-200, NIN-201, NIN-205, NIN-206, NIN-207, NIN-211
- W4 Surfaces: NIN-202, NIN-203, NIN-204, NIN-208, NIN-209, NIN-210, NIN-212, NIN-213, NIN-214, NIN-215, NIN-216, NIN-219, NIN-220
- W5: NIN-217, NIN-218

This list is a fixture for checking the current PRD only; the generator must derive future PRDs from Linear.

### Step 3 - Report runner readiness

**If launching under Codex (goal-forge):** run the config checker from the repo root:

```bash
python3 ~/.codex/skills/goal-forge/scripts/inspect_codex_config.py --project-path .
```

Report gaps, especially:

- `model_context_window = 1050000`
- `model_auto_compact_token_limit = 997500`
- `model_reasoning_effort = "high"` for throughput, though `xhigh` is acceptable for depth
- `[features] goals = true`
- trusted project settings with `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`

Do not edit config unless Omer explicitly asks.

**If launching under Claude Code:** there is no goal-forge config to check. Confirm instead that the worktree
is clean, `LINEAR_API_KEY` is exported in the session, and the `risoluto-tdd` / `v1-check` /
`risoluto-review-handoff` skills are available. Claude resumes long runs from the package's
PLAN.md/ATTEMPTS.md/NOTES.md rather than a durable goal engine, so expect to nudge it across a session restart.

### Step 4 - Print launch steps

Print the launch sequence for the runner Omer picks; do not launch the conductor yourself.

Codex (goal-forge):

```bash
cd /home/oruc/Desktop/workspace/risoluto
codex
/goal
# paste ~/.risoluto/goals/<slug>/GOAL.md
```

Claude Code:

```bash
cd /home/oruc/Desktop/workspace/risoluto
claude
# then: Execute the conductor goal in ~/.risoluto/goals/<slug>/GOAL.md —
#       follow its <workflow> and resume from PLAN.md / ATTEMPTS.md / NOTES.md.
```

## Output

End with:

- generated package path;
- waves/issues count;
- runner-readiness summary;
- launch commands (Codex and Claude Code);
- any blocker.

## Companion Files

- `references/GOAL.template.md` - runner-agnostic conductor prompt (goal-forge block shape).
- `references/SPEC.template.md` - human-readable source brief.
- `scripts/render.mjs` - deterministic renderer.
- `../references/linear-access.md` - portable Linear GraphQL operations.
- `skills/risoluto-review-handoff/` - different-model review artifact producer.
- `skills/risoluto-tdd/` - per-issue implementation method the goal may invoke.
