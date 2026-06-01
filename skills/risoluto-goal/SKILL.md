---
name: risoluto-goal
description: Generate a launchable Codex /goal package for a Risoluto PRD. Use for /risoluto-goal <slug>, "make the AFK goal", "generate the conductor goal", or preparing a PRD for autonomous implementation. Derives waves from the PRD Linear project's milestones, writes ~/.codex/goals/<slug>/{GOAL.md,SPEC.md,WAVES.md,CONTROL.md,PLAN.md,ATTEMPTS.md,NOTES.md}, reports Codex config readiness, and prints the launch steps. Does not run /goal, edit ~/.codex/config.toml, create PRs, or modify goal-forge.
---

# risoluto-goal

Generate the durable control package for a Risoluto AFK build. The generated `/goal` makes Codex both
conductor and implementer: it drains Linear issues wave by wave, uses one cascade integration branch, stops
for a different-model end-review, then fixes review findings and prints the PR command.

This skill is a generator, not the runner.

## Contract

- Topology is deterministic: `integration/<slug>` -> one active `wave/<n>-<slug>` -> per-issue worktrees
  -> wave -> integration. The next wave starts from the current integration tip.
- Waves are Linear project milestones sorted by `sortOrder`.
- Runtime ready-set is live Linear `blocked-by` state; `WAVES.md` is the frozen map, not issue status.
- Memory split: issue status in Linear, code in git, conductor process state in `~/.codex/goals/<slug>/`.
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
- This skill reports Codex config gaps; it does not edit `~/.codex/config.toml`.

## Goal-forge Integration

`references/GOAL.template.md` is the precompiled goal-forge block contract. It follows
`~/.codex/skills/goal-forge/references/goal_prompt_blocks.md` and embeds the constant cascade workflow in
`<workflow>`. Do not modify goal-forge for Risoluto behavior. If the prompt contract changes, edit this
skill's templates and re-render the package.

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
node skills/risoluto-goal/scripts/render.mjs <slug>
```

If `~/.codex/goals/<slug>/` already contains a draft package and Omer wants a refresh, rerun with
`--force`:

```bash
node skills/risoluto-goal/scripts/render.mjs <slug> --force
```

The script:

- reads `docs/prds/<slug>.md`;
- resolves the Linear project from `linear_project`;
- fetches project milestones and issues through `LINEAR_API_KEY` + GraphQL;
- writes `WAVES.md`, `SPEC.md`, `GOAL.md`, `CONTROL.md`, `PLAN.md`, `ATTEMPTS.md`, and `NOTES.md`;
- falls back to one unmilestoned wave only if the project has no milestones;
- refuses to silently overwrite an existing package unless `--force` is passed.

### Step 2 - Inspect the result

Read the generated summary and spot-check:

- `WAVES.md` wave count and issue count match Linear.
- Wave order follows milestone `sortOrder`.
- `GOAL.md` contains goal-forge blocks and the cascade in `<workflow>`.
- `CONTROL.md` contains only the live knobs: `paused`, `primary_priority`, `max_runtime_per_step`,
  `require_approval_for`, and `latest_nudge`.

For `workflow-first-afk-mvp`, the expected waves are:

- W1 Foundation: NIN-194, NIN-195
- W2 Skeleton: NIN-196, NIN-197, NIN-198, NIN-199
- W3 Engine: NIN-200, NIN-201, NIN-205, NIN-206, NIN-207, NIN-211
- W4 Surfaces: NIN-202, NIN-203, NIN-204, NIN-208, NIN-209, NIN-210, NIN-212, NIN-213, NIN-214, NIN-215, NIN-216, NIN-219, NIN-220
- W5: NIN-217, NIN-218

This list is a fixture for checking the current PRD only; the generator must derive future PRDs from Linear.

### Step 3 - Report Codex config readiness

Run the goal-forge config checker from the repo root:

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

### Step 4 - Print launch steps

Print the exact launch sequence; do not run `/goal` yourself:

```bash
cd /home/oruc/Desktop/workspace/risoluto
codex
/goal
# paste ~/.codex/goals/<slug>/GOAL.md
```

## Output

End with:

- generated package path;
- waves/issues count;
- config readiness summary;
- launch command;
- any blocker.

## Companion Files

- `references/GOAL.template.md` - compiled goal-forge block prompt.
- `references/SPEC.template.md` - human-readable source brief.
- `scripts/render.mjs` - deterministic renderer.
- `../references/linear-access.md` - portable Linear GraphQL operations.
- `skills/risoluto-review-handoff/` - different-model review artifact producer.
- `skills/risoluto-tdd/` - per-issue implementation method the goal may invoke.
