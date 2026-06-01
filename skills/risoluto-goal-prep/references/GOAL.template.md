<!--
  GOAL.template.md - constant, runner-agnostic conductor prompt for a Risoluto wave-cascade build.
  Rendered by /risoluto-goal-prep. Substitute every {{TOKEN}} and drop this comment.
  Block shape follows ~/.codex/skills/goal-forge/references/goal_prompt_blocks.md, but the prompt is
  runner-neutral: it executes under Codex goal-forge `/goal` or directly in Claude Code.
  Prompt style is outcome-first: explicit context budget, validation loops, and minimal process
  narration outside true invariants.
-->

<goal>
Deliver {{SLUG}} as a merge-ready integration branch.

Success means all {{ISSUE_COUNT}} Linear issues in WAVES.md are implemented through the cascade topology,
{{INTEGRATION_BRANCH}} is green at every wave boundary, REVIEW.md has no open HIGH findings, and the final
answer prints the exact `gh pr create` command without running it. Code changes must be committed on
{{INTEGRATION_BRANCH}} before the PR command is printed.
</goal>

<context>
Start with the minimum evidence needed to begin: AGENTS.md, {{PRD_PATH}}, {{GOAL_DIR}}WAVES.md,
{{GOAL_DIR}}CONTROL.md,
docs/product-spine.md, docs/technical-spine.md, and docs/research-to-shipping-pipeline.md Phase 4.
Read Linear issue details on demand from {{LINEAR_PROJECT_URL}}. Repo root: {{REPO_ROOT}}.

Context budget: before coding a wave, read its WAVES.md section and only the PRD sections that constrain it:
Implementation Decisions, Testing Decisions, Out of Scope, and cited User Stories. For each issue, read the
Linear issue body plus local code discovered by `rg`/`rg --files`. Retrieve more context only when a required
acceptance fact, owner, API contract, file, or failing check is missing. Do not read more to improve wording,
collect nonessential examples, or re-prove a decision already grounded in the PRD, Linear, git, or this goal
package.
</context>

<constraints>
True invariants:
- Branch topology is fixed: integration branch -> one wave branch -> per-issue worktrees -> wave branch ->
  integration branch. The next wave starts from the new integration tip.
- PRD "Out of Scope" is binding. If real adjacent work appears, create a Linear issue labelled `discovered`
  and leave the code untouched for this run.
- PR action is print-only: produce `gh pr create ...`; do not execute it.
- Config action is report-only: do not edit the runner's config (e.g. ~/.codex/config.toml under Codex).
- One authoritative store per fact: issue state lives in Linear, built code lives in git, process state lives
  in {{GOAL_DIR}}. Do not mirror the same fact into a second store.
- A tracker issue identifier is an external reference, not a Workflow Run id.
- TypeScript edits must respect the repo ceiling: complexity 15 per function.

Decision rule: choose the fewest useful tool and context loops that can satisfy the current issue correctly.
If a choice would branch a wave from master, run waves as siblings, merge a red wave, weaken done_when, or
violate the PRD, stop and record a blocker in PLAN.md.
</constraints>

<scorecard>
Primary metric: waves merged into {{INTEGRATION_BRANCH}} with /v1-check green, scored N/{{WAVE_COUNT}}.
Per-issue checkpoint: the issue is Done in Linear and its branch is merged into the current wave. Regression
check: after each wave merge, {{INTEGRATION_BRANCH}} still contains every earlier wave and the full gate
passed on the merged tip. Scoring commands/paths: {{GOAL_DIR}}WAVES.md, `git log --oneline
{{INTEGRATION_BRANCH}}`, Linear issue states, and the latest /v1-check output in NOTES.md. Stop condition:
all waves merged, review HIGH cleared, final gate green, and PR command printed; or a blocker requiring
credentials, authority, a product decision outside the PRD, or ownership judgment on a merge conflict.
</scorecard>

<done_when>

- Every issue in {{GOAL_DIR}}WAVES.md is Done in Linear and merged into {{INTEGRATION_BRANCH}} in cascade
  order.
- `/v1-check` passes on {{INTEGRATION_BRANCH}} after the final merge.
- {{GOAL_DIR}}REVIEW.md exists and has no open HIGH findings.
- All implementation and review-fix code changes are committed on {{INTEGRATION_BRANCH}}, and `git status -s`
  is clean before printing the PR command.
- The exact `gh pr create --base master --head {{INTEGRATION_BRANCH}} ...` command has been printed and not
  run.
  </done_when>

<feedback_loop>
Fast loop: after each code slice, run the focused test or smoke command that proves that slice's acceptance
criteria. Expected runtime: seconds to about 1 minute. Cadence: before committing an issue branch and again
after repairing a failed merge. Proxy validity: Risoluto slices are contract/integration shaped, so the
focused check proves the behavior before the expensive gate.

Escalation/final loop: run `/v1-check` before merging any wave into {{INTEGRATION_BRANCH}}, after end-review
fixes, and before printing the PR command. `/v1-check` means `pnpm run build && pnpm run lint && pnpm run
format:check && pnpm test && pnpm run typecheck && pnpm run typecheck:coverage`. If review fixes touch HTTP,
workflow-run contracts, storage/archive behavior, workflow definitions, or OpenAPI/Zod schemas, also run
`pnpm run test:integration` after `/v1-check`; do not run live integration without explicit approval.
</feedback_loop>

<workflow>
Use this workflow as the required topology and validation contract. Inside an issue, choose the simplest
implementation path that satisfies the PRD and Linear acceptance criteria.

Initial reconciliation:

1. `git fetch origin`.
2. Check git status and preserve unrelated work.
3. Ensure {{INTEGRATION_BRANCH}} exists. If absent, create it from `origin/master`.
4. Read {{GOAL_DIR}}CONTROL.md. If `paused: true`, write the pause to PLAN.md and stop.

For each wave in {{GOAL_DIR}}WAVES.md, in listed order:

1. Reconcile position from git, Linear, PLAN.md, and WAVES.md. Trust git and Linear over stale notes.
2. Create `wave/<number>-<wave-slug>` from the current {{INTEGRATION_BRANCH}} tip. This is the cascade
   anchor; it already contains every earlier merged wave.
3. Drain the live ready-set until the wave has no open issues:
   - Query Linear for this wave's issues and `blocked-by` edges.
   - Select the first issue whose blockers are Done. If none are ready, write the blocked issue list to
     PLAN.md and stop.
   - Create a per-issue worktree from the wave branch with the issue's branch name.
   - Claim the issue In Progress in Linear.
   - Implement against the issue acceptance criteria and PRD. Before broadening search, ask whether the
     current evidence is enough to implement and validate the acceptance claim. Use `/risoluto-tdd <issue>`
     as the local method when available; otherwise follow the same red/green/refactor shape directly.
   - Run the focused feedback check, commit the slice, merge the issue branch into the wave branch, remove
     the worktree, and comment the merge result on the issue.
   - Mark the issue Done in Linear only after the merge into the wave branch is complete.
4. Run `/v1-check` on the wave branch. On red, repair once using the exact failure output. If it remains red,
   append the evidence to ATTEMPTS.md, write the blocker to PLAN.md, and stop.
5. Merge the green wave branch into {{INTEGRATION_BRANCH}}. Update PLAN.md and NOTES.md with the wave result.
6. Continue to the next wave from the new {{INTEGRATION_BRANCH}} tip.

End review:

1. After the last wave merges, write "integration ready for end-review" to PLAN.md and stop for
   `/risoluto-review-handoff {{SLUG}}`.
2. When {{GOAL_DIR}}REVIEW.md exists, parse its JSON block. Fix findings in priority order. An open HIGH
   finding blocks the PR command.
3. After fixes, mark resolved findings in REVIEW.md, record focused evidence in NOTES.md, and append any
   failed final-gate attempt to ATTEMPTS.md before retrying.
4. Commit the review fixes on {{INTEGRATION_BRANCH}} with a conventional commit message. Do not leave
   PR-relevant code only in the working tree.
5. After the commit, rerun `/v1-check` on {{INTEGRATION_BRANCH}} and any required non-live integration suite.
   Confirm `git status --short` is clean, REVIEW.md has no open HIGH findings, and NOTES.md contains the
   post-commit evidence. If green, print the `gh pr create` command targeting master and terminate.
   </workflow>

<working_memory>
Maintain these files in {{GOAL_DIR}}:

- PLAN.md: current wave, current issue, next command, and any operator blocker. Update on every phase change.
- ATTEMPTS.md: failed approaches, exact evidence, and the next different adjustment. Append before retrying.
- NOTES.md: durable discoveries that affect later issues or resume behavior.
- WAVES.md: frozen map generated from Linear milestones. Treat it as read-only during the run.

On resume, reread all four files, then reconcile against git branches and Linear state before editing.
</working_memory>

<human_control_surface>
Use {{GOAL_DIR}}CONTROL.md as the small operator panel. Reread it before a wave change, gate retry, dependency
change, destructive action, or end-review handoff. It may pause work, narrow priority, change the
max_runtime_per_step, or require approval for scope_expansion/destructive_change/dependency_change. It cannot
weaken done_when, skip /v1-check, bypass PRD Out of Scope, or downgrade HIGH findings.
</human_control_surface>

<verification_loop>
Issue branch: focused acceptance check green before commit.
Wave branch: `/v1-check` green before merging wave -> integration.
Integration branch: `/v1-check` green after review fixes and before printing the PR command. When final
review fixes changed an integration boundary, include `pnpm run test:integration` as part of the final
evidence. Run final checks after committing so hooks cannot rewrite already-verified code.
Manual fallback: if a required live secret or external service is unavailable, record the unavailable check,
run the closest deterministic local check, and keep the missing live validation visible in PLAN.md.
</verification_loop>

<execution_rules>

- Check git status before edits and preserve unrelated changes.
- Prefer `rg`/`rg --files` for code discovery.
- Batch independent reads when the runtime supports it.
- Keep edits scoped to the current issue and PRD.
- Use the repo's patch/edit tool for manual edits.
- Run focused checks before broad checks.
- Do not paper over failures or widen scope.
- Budget: stop between steps at {{BUDGET_MINUTES}} minutes or {{BUDGET_USD}} USD; record the stop point in
  PLAN.md.
- Ask only for credentials, irreversible actions, ADR conflicts, merge conflicts requiring ownership
  judgment, or product decisions not covered by the PRD/Linear issue.
- Keep the final answer concise.
  </execution_rules>

<output_contract>
Final artifacts: {{INTEGRATION_BRANCH}} with {{WAVE_COUNT}}/{{WAVE_COUNT}} waves merged, Linear issues Done,
{{GOAL_DIR}}REVIEW.md with no open HIGH findings, a clean committed integration worktree, final /v1-check
evidence in NOTES.md, current PLAN.md / ATTEMPTS.md / NOTES.md, and the printed `gh pr create` command.
Final response: 10 lines or fewer with wave count, gate status, review status, commit hash, PR command, and
blockers if any. Report outcomes and evidence, not a full narration of the process.
</output_contract>
