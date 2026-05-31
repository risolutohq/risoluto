<!--
  SPEC.template.md - human-readable source brief for the rendered Risoluto /goal package.
  Rendered by /risoluto-goal alongside GOAL.md. GOAL.md is the compiled goal-forge block form.
-->

# SPEC - {{SLUG}} autonomous wave-cascade build

## Goal

Implement the {{SLUG}} PRD end to end as a bounded Codex `/goal`: {{ISSUE_COUNT}} Linear issues across
{{WAVE_COUNT}} Linear milestone waves, merged through {{INTEGRATION_BRANCH}}, gate green, review HIGH
cleared, and PR command printed.

## Non-goals

- The conductor does not create the GitHub PR or merge to master.
- The conductor does not edit `~/.codex/config.toml`.
- The conductor does not implement work outside {{PRD_PATH}}. Adjacent findings become `discovered` Linear
  issues.
- The goal package is process state outside git; it is not a repo documentation surface.

## Scope Source

- PRD: {{PRD_PATH}}
- Linear project: {{LINEAR_PROJECT_URL}}
- Frozen wave plan: {{GOAL_DIR}}WAVES.md
- Architecture rules: PRD Implementation Decisions, Testing Decisions, Out of Scope, and relevant ADRs.

## Topology

One integration branch, one active wave branch, per-issue worktrees off the active wave branch. Merge order is
issue -> wave -> {{INTEGRATION_BRANCH}}. The next wave branches from the new integration tip.

## Scorecard

Primary metric: waves merged green, scored 0/{{WAVE_COUNT}} through {{WAVE_COUNT}}/{{WAVE_COUNT}}. Regression:
`/v1-check` stays green on {{INTEGRATION_BRANCH}} after every wave merge and after review fixes. Stop:
all waves merged, no open HIGH review findings, final gate green, PR command printed.

## Feedback Loop

Fast check: focused acceptance test/smoke for the current issue before commit. Slow check: `/v1-check` at
wave boundaries and final PR readiness.

## Working Memory

{{GOAL_DIR}}PLAN.md tracks position, {{GOAL_DIR}}ATTEMPTS.md records failed approaches, {{GOAL_DIR}}NOTES.md
stores durable learnings, and {{GOAL_DIR}}CONTROL.md is the operator panel. WAVES.md is read-only at runtime.

## Done When

- Every WAVES.md issue is Done in Linear and merged in cascade order.
- `/v1-check` passes on {{INTEGRATION_BRANCH}}.
- {{GOAL_DIR}}REVIEW.md exists with no open HIGH findings.
- `gh pr create --base master --head {{INTEGRATION_BRANCH}} ...` is printed and not run.

## Memory Authority

Issue status -> Linear. Built code -> git. Conductor process state -> {{GOAL_DIR}}. One fact, one store.
