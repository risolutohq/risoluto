<goal>
Make `/home/oruc/Desktop/workspace/risoluto-v1` clean, current, dependency-updated, and reviewable as a fresh backend-first Risoluto v1 foundation branch for `risolutohq/risoluto`.

The finished branch must read as a clean v1 foundation, not a copied legacy repo. CLI remains the primary product surface, TUI remains next, HTTP API remains support/internal, and web frontend/docs-site/dashboard/runtime assumptions remain excluded.
</goal>

<context>
Repo: `/home/oruc/Desktop/workspace/risoluto-v1`
Remote: `origin` -> `https://github.com/risolutohq/risoluto.git`
Primary branch: `master`
Canonical merged transition artifact: `docs/v1-transition-goal.md`

Read first:

- `AGENTS.md`
- `README.md`
- `docs/v1-transition-goal.md`
- `docs/product-spine.md`
- `docs/technical-spine.md`
- `docs/decisions.md`
- `docs/testing-strategy.md`
- `docs/release-rules.md`
- `package.json`
- `pnpm-lock.yaml`
- `.github/`
- `.husky/`
- `Dockerfile`
- `scripts/`
- `tests/`
- `src/http/`
- `src/cli/`

Required initial discovery:

- `git fetch --all --prune`
- `git status --short --branch`
- `git remote -v`
- `git branch --show-current`
- If `gh` is available: inspect open PRs for `risolutohq/risoluto`, especially Dependabot PRs.
- Inspect and account for these remote branches:
  - `origin/dependabot/npm_and_yarn/production-dependencies-66f2206a21`
  - `origin/dependabot/npm_and_yarn/dev-dependencies-0fbd5dc5bb`

Required exact drift search with `rg`:

- `legacy`
- `frontend`
- `dashboard`
- `docs-site`
- `roadmap`
- `old`
- `conformance`
- `screenshot`
- `playwright`
- `vite`
- `react`
- `anvil`
- `risoluto-legacy`
- `getrisoluto`
- `omerfarukoruc/risoluto`

Use `rg` for exact search. Optional semantic search tools may be used for exploration if they work locally, but they are not a substitute for the required exact searches above.
</context>

<constraints>
Project identity and product constraints:
- Risoluto v1 is a clean foundation baseline.
- The core primitive is `Workflow Run`, not tracker issue.
- Trackers are intake, mirror, and projection adapters.
- CLI is primary.
- TUI is next.
- HTTP API is support/internal.
- Web frontend is excluded for now.
- Docs-site is excluded for now.

Non-goals and hard exclusions:

- Do not rebuild the frontend.
- Do not add a docs-site.
- Do not recreate old roadmap/status ledgers.
- Do not invent v2/v3/v4 plans.
- Do not reintroduce browser, Playwright, screenshot, dashboard, Vite, React, docs-site, or frontend runtime assumptions.
- Do not delete backend capabilities merely because names still say issue, attempt, or run; rename only when the change is safe, scoped, and directly tied to this cleanup.
- Do not erase useful tests just to make checks pass.
- Do not touch secrets.
- Do not require private research repos or submodules.
- Do not rewrite git history or force-push.
- Do not hide dependency updates inside broad architecture rewrites.
- Do not edit these Desktop planning source files unless explicitly needed:
  - `/home/oruc/Desktop/risoluto-v1-step1-github-org-repo-prompt.md`
  - `/home/oruc/Desktop/risoluto-v1-step2-legacy-repo-transition-prompt.md`
  - `/home/oruc/Desktop/risoluto-v1-step3-foundation-docs-completion-log.md`
  - `/home/oruc/Desktop/risoluto-v1-step4-curated-snapshot-import-completion-log.md`
  - `/home/oruc/Desktop/risoluto-v1-transition-agent-handoff.md`

Dependency constraints:

- Apply dependency updates safely to newest compatible versions.
- Compare current dependency state against both named Dependabot branches before deciding how to apply updates.
- Incorporate the Dependabot updates by merge/cherry-pick or manual reproduction, whichever creates the cleaner, safer diff.
- Use controlled batches when failures become hard to diagnose.
- If a latest dependency requires large architecture work, document and pin/defer it instead of forcing an unsafe rewrite.
- Check GitHub Actions versions and update invalid or stale actions safely.

</constraints>

<scorecard>
Primary checklist: v1 drift cleanup plus safe dependency update readiness.

Passing threshold: all checklist items below are true, with evidence recorded in `.codex/goals/v1-drift-deps-cleanup/ATTEMPTS.md` or `.codex/goals/v1-drift-deps-cleanup/NOTES.md`.

Checklist:

- Required drift searches were run and reviewed.
- No stale repo identity references remain except intentional historical notes in `docs/v1-transition-goal.md`.
- No frontend/docs-site/dashboard runtime assumptions remain in package scripts, CI, docs, tests, or source.
- Useful backend source and tests are preserved unless clearly dead or stale.
- Both named Dependabot branches were inspected and either incorporated or documented as superseded.
- Production and dev dependency updates were applied safely and are reviewable.
- `pnpm audit --prod` is clean, or every remaining advisory has a documented defer reason.
- GitHub Action versions were checked and updated if needed.
- Required verification commands pass, or skip/fail results are documented with concrete blockers.
- Final diff separates dependency maintenance from any scoped cleanup decisions clearly enough for review.
- Branch is pushed and a PR is opened if possible.

Regression checks:

- CLI remains the primary runnable surface.
- TUI remains future work, not newly introduced as implementation scope.
- HTTP API remains support/internal.
- No frontend/docs-site/browser test surface is reintroduced.
- No backend capability is removed solely due to naming drift.

Scoring method:

- Use `rg` search results, `git diff`, `git diff --stat`, `pnpm audit --prod`, validation command output, branch/PR state, and `.codex/goals/v1-drift-deps-cleanup/*` notes.

Stop condition:

- Stop only when the done_when criteria are met, or when a documented blocker requires Omer's decision because continuing would violate constraints.

</scorecard>

<done_when>
Done only when all of these are true:

- A new branch exists containing the cleanup and dependency updates.
- The branch is pushed to `origin`.
- A PR is opened if `gh` and repository permissions allow it; otherwise the exact push result and PR blocker are documented.
- `.codex/goals/v1-drift-deps-cleanup/PLAN.md` describes the executed plan and final state.
- `.codex/goals/v1-drift-deps-cleanup/ATTEMPTS.md` records meaningful dependency batches, cleanup attempts, checks, failures, fixes, and final verification results.
- `.codex/goals/v1-drift-deps-cleanup/NOTES.md` records durable discoveries, intentional deferrals, and any follow-up debt.
- `.codex/goals/v1-drift-deps-cleanup/CONTROL.md` exists and reflects the final operator settings used.
- Both named Dependabot branches have an explicit recorded outcome: incorporated, cherry-picked, manually reproduced, or superseded with evidence.
- Required drift searches have been run and no conflicting stale assumptions remain outside intentional historical notes in `docs/v1-transition-goal.md`.
- `pnpm audit --prod` passes cleanly, or every remaining advisory has a documented reason and owner-visible defer note.
- Final verification commands have been run and recorded as pass, skip, or fail:
  - `pnpm run build`
  - `pnpm run lint`
  - `pnpm run format:check`
  - `pnpm run typecheck`
  - `pnpm test`
  - `pnpm run test:integration`
  - `pnpm run test:integration:live`, confirming it skips cleanly if credentials are absent
  - `pnpm audit --prod`
  - local Gitleaks scan if available, or a note explaining why unavailable
  - Docker build if Docker is available
  - `gh run list` or remote CI check after push if `gh` is available
- Remote CI is green, or any remote-only failure has been investigated and fixed unless blocked by missing credentials/secrets.

</done_when>

<feedback_loop>
Fast feedback while iterating:

- `pnpm run format:check`
- `pnpm run typecheck`
- Targeted tests for changed source/test areas.
- `pnpm audit --prod` after dependency batches.

Expected runtime:

- `format:check`, `typecheck`, focused tests, and audit should be short enough to run after each meaningful cleanup or dependency batch.

Cadence:

- Run the fast loop after each meaningful dependency batch, script/CI cleanup, or source/test fix.
- When a fast check fails, fix or record the failure before broadening the batch.

Proxy validity:

- `format:check` catches repo-wide formatting drift.
- `typecheck` catches API and dependency typing breakage early.
- Focused tests catch changed behavior without waiting for the full suite.
- `pnpm audit --prod` catches production advisory regressions as dependencies move.

Slower escalation and final checks:

- Use `pnpm run build`, `pnpm run lint`, full `pnpm test`, integration suites, live integration skip verification, Gitleaks, Docker build, and remote CI only after focused checks are stable or when a dependency/update failure cannot be isolated faster.

</feedback_loop>

<workflow>
1. Orient and record baseline.
   - Reread `AGENTS.md`, `docs/v1-transition-goal.md`, `package.json`, CI, and current git state.
   - Run `git fetch --all --prune`.
   - Create or update the working-memory files.
   - Create a new branch from `master` with prefix `codex/`.

2. Inspect drift.
   - Run the required `rg` search set.
   - Inspect README, docs, package scripts, CI, scripts, tests, `src/http/`, and `src/cli/`.
   - Classify each hit as intentional historical note, current valid backend/tracker concept, stale docs/runtime assumption, or uncertain.
   - Remove or rewrite stale assumptions only where they conflict with the v1 foundation.

3. Inspect dependency branches.
   - Compare `package.json` and `pnpm-lock.yaml` against:
     - `origin/dependabot/npm_and_yarn/production-dependencies-66f2206a21`
     - `origin/dependabot/npm_and_yarn/dev-dependencies-0fbd5dc5bb`
   - Record branch heads, relevant package changes, and whether each is merged/cherry-picked/manually reproduced/superseded.

4. Apply safe dependency updates.
   - Update production and dev dependencies in controlled batches.
   - Prefer `pnpm install --lockfile-only` for safe lockfile regeneration when appropriate.
   - Run the fast feedback loop after each meaningful batch.
   - Fix blockers caused by dependency updates.
   - Pin/defer any breaking latest version that would require a large architecture rewrite.

5. Check CI and action drift.
   - Inspect `.github/` for invalid or stale action versions.
   - Update actions safely, preserving backend-first CI.
   - Keep frontend/docs-site/browser assumptions out of CI.

6. Final verification.
   - Run every command in `<verification_loop>`.
   - Record pass/skip/fail results in `ATTEMPTS.md`.
   - Investigate failures; fix when in scope.

7. Publish.
   - Review `git diff` and `git status`.
   - Commit with a reviewable message, likely `chore(deps): refresh v1 foundation dependencies`.
   - Push the branch.
   - Open a PR if possible.
   - Check remote CI with `gh run list` or equivalent if available.

</workflow>

<working_memory>
Create and maintain:

- `.codex/goals/v1-drift-deps-cleanup/PLAN.md`
- `.codex/goals/v1-drift-deps-cleanup/ATTEMPTS.md`
- `.codex/goals/v1-drift-deps-cleanup/NOTES.md`
- `.codex/goals/v1-drift-deps-cleanup/CONTROL.md`

Update cadence:

- Update `PLAN.md` at phase changes, after dependency strategy changes, and before publishing.
- Update `ATTEMPTS.md` after each meaningful dependency batch, cleanup attempt, failed check, successful check, and final verification command.
- Update `NOTES.md` whenever durable context, branch comparison results, deferred dependency reasons, stale-reference classification, or blocker evidence should survive compaction.
- Reread `CONTROL.md` before each phase change, strategic pivot, expensive step, dependency defer, or PR publication.

</working_memory>

<human_control_surface>
Use `.codex/goals/v1-drift-deps-cleanup/CONTROL.md` as the compact operator panel for this goal.

Initial controls:

- `dependency_update_mode: safe_latest`
- `docs_cleanup_mode: remove_or_rewrite_stale`
- `push_mode: branch_and_pr`
- `allow_frontend_reintroduction: false`
- `allow_docs_site_reintroduction: false`
- `allow_large_architecture_rewrites: false`

Before each phase change, strategic pivot, expensive step, dependency defer, or sidecar input, reread `CONTROL.md`. If it changed, summarize the relevant change in `PLAN.md` and adapt before proceeding.

`CONTROL.md` may narrow priorities or require approval. It must not silently weaken the scorecard, done_when criteria, or v1 exclusion constraints.
</human_control_surface>

<verification_loop>
Fast checks while working:

- `pnpm run format:check`
- `pnpm run typecheck`
- Targeted tests for changed areas.
- `pnpm audit --prod`

Final verification before completion:

- `pnpm run build`
- `pnpm run lint`
- `pnpm run format:check`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run test:integration`
- `pnpm run test:integration:live`
- `pnpm audit --prod`
- Local Gitleaks scan if available, or document why unavailable.
- Docker build if Docker is available.
- `gh run list` or equivalent remote CI inspection after push if `gh` is available.

Fallback rules:

- If credentials are absent for live integration tests, confirm the suite skips cleanly and record the exact evidence.
- If Docker is unavailable, record the command attempted and why it could not run.
- If `gh` is unavailable or unauthenticated, record local publish state and the exact PR/CI command that would be run.
- Do not mark the goal complete with unexplained failing checks.

</verification_loop>

<execution_rules>

- Follow repository instructions in `AGENTS.md`.
- Use Node.js 22 or newer.
- Check git status before edits.
- Preserve unrelated user changes.
- Keep changes scoped to this goal.
- Prefer `rg` for exact search.
- Use `apply_patch` for manual edits.
- Batch independent file reads in parallel when possible.
- Do not rewrite git history.
- Do not force-push.
- Do not reintroduce frontend/docs-site assumptions.
- Keep docs current or absent; stale docs are worse than no docs.
- Keep the goal scorecard current: know the primary checklist, passing threshold, regression checks, scoring method, and stop condition.
- Use the fastest representative feedback check while iterating; reserve slower checks for escalation points and final verification.
- Update `ATTEMPTS.md` after each meaningful approach so future iterations do not repeat work without new evidence.
- Run focused tests before broad tests.
- Do not paper over failures.
- Do not widen scope.
- Separate confirmed repo state from proposed documentation or follow-up debt.
- Keep the final answer concise and evidence-led.

</execution_rules>

<output_contract>
Final artifacts:

- Updated branch pushed to `origin`.
- PR URL if PR creation succeeds.
- Updated `.codex/goals/v1-drift-deps-cleanup/PLAN.md`.
- Updated `.codex/goals/v1-drift-deps-cleanup/ATTEMPTS.md`.
- Updated `.codex/goals/v1-drift-deps-cleanup/NOTES.md`.
- Updated `.codex/goals/v1-drift-deps-cleanup/CONTROL.md`.

Final response:

- Name the branch and PR URL or PR blocker.
- Summarize user-visible changes first.
- Report dependency branch outcomes.
- Report final verification pass/skip/fail results.
- Report any documented deferrals or follow-up debt.
- Include git/app directives only for actions that actually succeeded.

</output_contract>
