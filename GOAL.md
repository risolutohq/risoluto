<goal>
Run an autonomous Risoluto architecture-deepening loop in `/home/oruc/Desktop/workspace/risoluto`.

Repeatedly discover architecture deepening candidates with `$improve-codebase-architecture`, select one safe high-confidence candidate without asking Omer, create/update Linear issues as the durable memory and control surface, implement exactly one candidate per separate worktree using `$tdd`, verify, review with `$code-review`, merge completed work directly back to `master`, push `origin master`, and repeat until no safe, verifiable, high-confidence one-worktree architecture candidate remains.
</goal>

<context>
Start in `/home/oruc/Desktop/workspace/risoluto`.

Read these first:

- `AGENTS.md`
- `FILETREE.md`
- `docs/product-spine.md`
- `docs/technical-spine.md`
- `docs/decisions.md`
- Relevant `docs/adr/*.md` for any touched area
- Relevant local `AGENTS.md` files under touched subdirectories, if present

Initial repo facts from compilation:

- Branch is expected to be `master`.
- Remote is expected to be `origin https://github.com/risolutohq/risoluto.git`.
- The `research/` submodule is a hard prerequisite.
- Canonical full gate:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck
```

Use the Linear MCP at startup:

- List teams and projects.
- Select the Risoluto team/project only if exactly one clear match exists by name, repository link, issue history, or project description.
- If no unambiguous target exists, stop before repo changes and report the blocker. Do not guess.
- Use a unique run id for this loop. Before creating the parent issue, search Linear for an active parent issue for this repo/run. Reuse it if present; otherwise create one parent issue with the unique run id.

Use these discovery commands when needed:

```bash
git submodule status research
git status --short
git branch --show-current
git remote -v
git fetch origin master
git worktree list
git branch --all
rg --files
```

</context>

<constraints>
Do not ask Omer for interactive approval during execution. Use Linear for passive controls and durable status. If authority is missing, stop, block, or defer instead of asking in chat.

Use these skills as operating procedures:

- `$improve-codebase-architecture` for candidate discovery and baseline/final HTML architecture reports.
- `$tdd` for implementation: vertical behavior slices, one public-interface test at a time, minimal code to pass, then refactor while green.
- `$code-review high` by default and `$code-review xhigh` for high-risk areas.

Architecture and product constraints:

- Workflow Run is the core primitive, not tracker issue.
- CLI is primary, TUI is next, HTTP API is support/internal.
- Do not reintroduce web frontend, dashboard, docs-site, or legacy roadmap assumptions.
- Respect ADRs. If a candidate contradicts an ADR or requires a product decision, defer or block it instead of forcing through.
- Update nearby docs only for code-truth alignment.
- Do not implement unrelated cleanup, style churn, dependency updates, broad rewrites, or speculative architecture.
- Do not change product behavior unless the candidate explicitly proves a code-truth alignment or bugfix need and validates it through public behavior.
- Subagent/model-review findings are evidence, not authority. Verify every finding against the actual diff and source before acting.

Runtime memory constraints:

- Linear and `/tmp/risoluto-architecture-loop/<run-id>/` are the only runtime memory surfaces.
- Do not create or maintain runtime repo-local scratch markdown such as `PLAN.md`, `ATTEMPTS.md`, `NOTES.md`, or `CONTROL.md`.
- `GOAL.md` is a preparation artifact only. Before starting the actual loop, delete or move `GOAL.md` outside the repo unless Omer explicitly approves keeping it.
- In Phase 0, verify no unapproved repo-local planning/scaffold markdown exists. If it exists, stop before creating Linear issues or editing code and report the cleanup blocker.

Concurrency constraints:

- Omer may work concurrently in other worktrees/branches.
- Other agents may work concurrently.
- Avoid conflict domains already claimed by active Linear issues, branches, or worktrees.
- Defer a candidate and choose another if another agent is touching the same files/modules.
- Stop or mark blocked if a merge/rebase conflict requires product or ownership judgment.
  </constraints>

<scorecard>
Primary metric: per-candidate architecture deepening score, recorded in the parent Linear issue candidate table and the child Linear issue.

Score each candidate on a 20-point rubric:

- Architecture leverage, 0-5: caller-facing interface gets simpler while behavior behind it becomes deeper.
- Locality gain, 0-5: knowledge, bugs, and future changes concentrate in fewer modules.
- Testability gain, 0-5: public-interface tests become easier, stronger, or less mock-coupled.
- Safety and concurrency fit, 0-5: candidate is small enough for one worktree, avoids claimed domains, and has clear verification.

Threshold:

- Prefer candidates scoring `16+`.
- Candidates scoring `14-15` are eligible when safety/concurrency is at least `3` and the architecture benefit is concrete.
- Candidates below `14` are deferred unless fresh evidence raises the score.

Scoring inspection path:

- Candidate scores must live in the parent Linear issue candidate table and the matching child issue.
- Each score must link or cite source files, tests, ADR/docs, active Linear conflict-domain check, and git worktree/branch check.
- Model judgment alone is not enough.

Regression checks for a selected candidate:

- Focused public-interface tests covering the changed behavior.
- `pnpm run build` after material TypeScript/interface movement.
- Relevant integration suites when the candidate touches integration boundaries and the suite can run in the current environment: `test:integration`, `test:integration:sqlite`, `test:integration:contracts`, `test:integration:live`, `test:load`, or `test:docker`.
- Full gate before merge:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck
```

- `$code-review high` by default.
- `$code-review xhigh` for high-risk areas.
- Two independent read-only reasoning review passes for high-risk diffs if available.

Stop condition:

- Stop when a fresh architecture review finds no remaining safe, verifiable, high-confidence one-worktree candidates above threshold.
- Also stop when all remaining candidates are speculative, too broad, product-decision-heavy, ADR-conflicting, actively conflicted with other work, not safely verifiable, or below threshold after fresh repo evidence.
  </scorecard>

<done_when>
The goal is complete only when all of these are true:

- Parent Linear issue has baseline HTML report, loop log, stop reason, final before/after HTML report, completed Linear issue list, validation evidence, review evidence, merge evidence, and remaining skipped/deferred candidates.
- Every selected candidate has a child Linear issue with score, conflict-domain check, branch/worktree, TDD evidence, focused test evidence, full gate evidence, review evidence, merge/push evidence, and final status.
- Each merged candidate passed focused tests and then:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck
```

- Each merged candidate touching an integration boundary ran the relevant integration suite when the suite could run in the current environment, or recorded why the suite could not run.
- Each high-risk merged candidate includes `$code-review xhigh` evidence and two independent read-only reasoning review passes if available, or a recorded reason why fewer independent passes were available.
- Confirmed `P1` and `P2` correctness findings from reviews are fixed before merge.
- Real non-blocking `P3` findings are fixed when cheap and relevant, or represented in Linear as follow-up work.
- Final `$improve-codebase-architecture` scan has produced a final before/after HTML artifact explaining what changed and why no safe high-confidence candidate remains.
- `master` is clean, up to date, and pushed to `origin`.
- Candidate worktrees are removed.
- No runtime repo-local scratch markdown remains, including unapproved `GOAL.md`, `PLAN.md`, `ATTEMPTS.md`, `NOTES.md`, or `CONTROL.md`.
  </done_when>

<feedback_loop>
Fast candidate loop:

- Write or adjust one public-interface behavior test.
- Run the narrowest focused command that exercises that behavior, usually:

```bash
pnpm exec vitest run <focused-test-file>
```

- Make the minimal implementation change to pass.
- Repeat one vertical slice at a time.
- Run `pnpm run build` after material TypeScript/interface movement.

Expected runtime:

- Focused Vitest slice: about 10 seconds to 3 minutes depending on touched area.
- Focused build/type movement check: usually a few minutes.

Cadence:

- Run the focused check after each TDD slice.
- Run the focused check after each non-trivial refactor.
- Run the focused check after each review fix.
- Update the child Linear issue after each meaningful TDD slice, focused test run, full gate, review, verified fix, merge/push, defer, or block.
- Update the parent Linear issue at startup, after baseline report creation, after candidate selection, after each candidate completion/defer/block, before pause/stop, and after final report creation.

Proxy validity:

- The fast loop is representative because architecture-deepening candidates must be validated through the public interface they deepen.
- It is only a proxy for the touched seam and is not sufficient for merge.

Slower escalation/final checks:

- Relevant integration suites for touched integration boundaries.
- Full Risoluto gate before merge and after any rebase or review fix:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck
```

- `$code-review high` by default, `$code-review xhigh` for high-risk areas.
- Independent read-only reasoning reviews for high-risk diffs if available.
  </feedback_loop>

<workflow>
Phase 0: Preflight

- Read required repo instructions and spine docs.
- Verify Node.js is `>=22` and pnpm is available.
- Verify `research/` is initialized with `git submodule status research`.
- Verify main checkout is clean `master`.
- Verify `GOAL.md` and other unapproved planning/scaffold markdown are absent from the repo, or stop before repo changes and report the cleanup blocker.
- Fetch latest `origin master`.
- Pull with `git pull --ff-only origin master`.
- If dependencies are missing, run `pnpm install --frozen-lockfile`.
- Use the Linear MCP to autodiscover the Risoluto team/project.
- Search Linear for an active parent issue for this repo/run. Reuse it if present; otherwise create one parent Linear issue with a unique run id.

Phase 1: Baseline architecture report

- Run `$improve-codebase-architecture` in discovery/report mode.
- Write baseline HTML to `/tmp/risoluto-architecture-loop/<run-id>/baseline-architecture.html`.
- Attach or link the report in the parent Linear issue.
- Do not ask Omer which candidate to explore.
- Extract candidate cards into the loop scorecard.

Phase 2: Candidate selection

- Score all discovered candidates.
- Filter out candidates blocked by stop/defer conditions.
- Query Linear and git for conflict domains.
- Select one eligible candidate autonomously.
- Create one child Linear issue and claim its conflict domain.

Phase 3: Worktree and branch

- Create exactly one separate worktree and branch for the selected child issue.
- Branch name: `codex/arch-loop-<linear-key>-<short-slug>`.
- Worktree path: `/home/oruc/.codex/worktrees/risoluto-architecture-loop/<run-id>/<linear-key>-<short-slug>`.
- Rebase the branch onto latest `origin/master` before edits.

Phase 4: TDD implementation

- Use `$tdd`.
- For `$tdd` planning, the child Linear issue contract is the user-approved interface/behavior plan. If it is insufficient, block/defer in Linear instead of asking Omer in chat.
- Work in vertical slices: one public-interface behavior test, minimal implementation, focused test pass, repeat.
- Default to behavior-preserving refactors.
- If behavior must change, make the behavior change explicit in the child issue and test it through the public interface.
- Update nearby docs only for code-truth alignment.
- If a candidate contradicts an ADR or needs a new product decision, defer or block it.

Phase 5: Verification and review

- Run focused tests first.
- Run relevant integration suites when the candidate touches an integration boundary and the suite can run in the current environment.
- Run the full Risoluto gate.
- Run `$code-review high`, or `$code-review xhigh` for high-risk areas.
- For high-risk diffs, run two independent read-only reasoning review passes if available. Prefer GPT-5.5 with xhigh reasoning if configured; otherwise use the strongest configured GPT-5.x reviewer available. Do not block solely because a named model is unavailable.
- Verify every review finding against the diff and source before acting.
- Fix confirmed `P1` and `P2` correctness findings before merge.
- Fix `P3` findings when cheap and relevant; otherwise create or update a Linear follow-up if the issue is real but not a merge blocker.
- Rerun focused tests and the full gate after fixes.

High-risk areas requiring `$code-review xhigh` and independent reasoning review if available:

- Persistence, migrations, artifact stores, raw evidence, or event log behavior.
- Secrets, auth, credential resolution, sandbox permissions, or model credentials.
- Tracker adapters, especially Linear intake/mirror/projection behavior.
- Workflow transitions, gates, hooks, scheduler, retry, or Workflow Run state.
- Agent runtime, Codex harness/session/turn execution, compaction, or cancellation.
- CLI public behavior.
- CI, release, hooks, or validation automation.

Phase 6: Merge and push

- Ensure the main checkout is clean `master`.
- Fetch and `git pull --ff-only origin master`.
- Rebase the candidate branch onto latest `origin/master`.
- Rerun focused tests and the full gate after any rebase.
- Fast-forward merge the completed branch directly into local `master`.
- Do not force-push, do not rewrite shared history, and do not skip hooks.
- If `master` moves or push is rejected, fetch, update `master` with `git pull --ff-only origin master`, rebase the candidate branch, rerun focused tests and the full gate, then retry the fast-forward merge and normal push.
- Push `origin master`.
- Record merge commit/hash, push evidence, and validation evidence in the child and parent Linear issues.
- Remove the completed candidate worktree after merge evidence is recorded.

Phase 7: Repeat or stop

- Rerun discovery enough to detect whether the previous merge changed the candidate landscape.
- Update the parent issue.
- Select the next eligible candidate.
- Stop when no safe high-confidence one-worktree candidate remains.

Block/defer rules:

- If one candidate blocks but another eligible candidate exists, defer the blocked candidate and continue.
- Block a candidate when credentials or MCP access are unavailable, a merge/rebase conflict requires product or ownership judgment, an ADR conflict cannot be resolved by code-truth doc alignment, behavior cannot be validated without external authority or missing infrastructure, or another agent claims the same conflict domain after the candidate starts.
- Stop the whole loop when every remaining candidate is blocked, deferred, below threshold, too broad, speculative, product-decision-heavy, ADR-conflicting, actively conflicted, or not safely verifiable.
  </workflow>

<working_memory>
Do not create runtime repo-local working-memory markdown.

Runtime working memory lives only in:

- Parent Linear issue: loop ledger and passive control surface.
- Child Linear issues: candidate-specific memory.
- `/tmp/risoluto-architecture-loop/<run-id>/`: baseline/final HTML reports and optional per-candidate logs.

Parent Linear issue must include:

- Current loop status.
- Baseline architecture report attachment/link.
- Candidate scorecard summary table.
- Child issue list.
- Completed candidate list.
- Deferred/skipped/blocked candidate list with reasons.
- Validation, review, merge, and push evidence.
- Final before/after report attachment/link.
- Stop reason.

Child Linear issues must include:

- Candidate summary.
- Conflict domain as explicit path globs/modules.
- Scorecard values and selection reason.
- Worktree path and branch name.
- TDD plan and per-cycle evidence.
- Focused test evidence.
- Full gate evidence.
- `$code-review` evidence.
- Independent reasoning review evidence when applicable.
- Verified findings and fixes.
- Merge and push evidence.
- Final status: completed, deferred, skipped, or blocked.

Update cadence:

- Parent issue: startup, baseline report creation, candidate selection, each candidate completion/defer/block, before pause/stop, and final report creation.
- Child issue: before edits, after each meaningful TDD slice, after focused tests, after full gate, after review, after verified fixes, after merge/push, and when blocked/deferred.
  </working_memory>

<human_control_surface>
Use the parent Linear issue as the compact human control surface. Do not create `CONTROL.md`.

Before selecting the next candidate and before expensive or irreversible steps, reread the parent Linear issue and honor these passive controls if present:

- `Loop control: PAUSE` means stop after the current safe checkpoint.
- `Loop control: STOP` means stop immediately after cleaning up any unmerged worktree state that can be cleaned safely.
- `Excluded domains:` path globs/modules that must not be touched.
- `Priority domains:` path globs/modules that can break ties between otherwise similar candidates.

No chat approval is required or expected. If the next action would require Omer's authority, block/defer/stop and record the reason in Linear.

The parent Linear issue can narrow priorities, pause, stop, or exclude domains. It cannot silently weaken the done_when criteria, scorecard thresholds, verification gate, or safety rules in this contract.
</human_control_surface>

<verification_loop>
Per candidate:

- Run focused public-interface tests first.
- Run `pnpm run build` after material TypeScript/interface movement.
- Run relevant integration suites only when the candidate touches an integration boundary and the suite can run in the current environment.
- Run the full gate before review/merge and after any rebase or verified review fix:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck
```

- Run `$code-review high` by default.
- Run `$code-review xhigh` for high-risk areas.
- Run two independent read-only reasoning review passes for high-risk diffs if available.
- Verify every finding against the diff and source before acting.
- Record all command outputs or concise evidence summaries in the child Linear issue.

Before merging:

- Main checkout is clean `master`.
- Candidate branch is rebased onto latest `origin/master`.
- Focused tests and full gate have passed after the latest rebase/fix.
- Child Linear issue contains score, conflict-domain check, TDD evidence, verification evidence, review evidence, and final candidate status.

Final verification:

- Rerun `$improve-codebase-architecture`.
- Produce `/tmp/risoluto-architecture-loop/<run-id>/final-before-after.html`.
- Attach or link baseline and final HTML in the parent Linear issue.
- Confirm `master` is clean, up to date, and pushed to `origin`.
- Confirm candidate worktrees are removed.
- Confirm no runtime repo-local scratch markdown remains.
  </verification_loop>

<execution_rules>
Check git status before edits and before every merge/push.
Preserve unrelated user changes.
Prefer `rg` over `grep` when available.
Use the runtime's patch/edit tool for manual edits when available.
Read context files before implementation.
Batch independent file reads in parallel when the runtime supports it.
Keep the scorecard current in Linear: primary metric, threshold, regression checks, scoring evidence, and stop condition.
Use the fastest representative feedback check while iterating; reserve slower checks for escalation points and final verification.
Use Linear and `/tmp/risoluto-architecture-loop/<run-id>/` for long-running memory. Do not create repo-local `PLAN.md`, `ATTEMPTS.md`, `NOTES.md`, or `CONTROL.md`.
Run focused tests before broad tests.
Do not paper over failures.
Do not widen scope.
Do not ask Omer during execution unless the goal is blocked by credentials/MCP access, irreversible action, ADR conflict, merge conflict requiring ownership judgment, or a product decision not covered by this contract. Even then, prefer marking blocked in Linear and stopping over chat approval.
Do not use destructive commands, force-push, rewrite shared history, skip hooks, or revert unrelated changes.
Do not leave runtime scratch markdown in the repo.
Keep final output concise and evidence-backed.
</execution_rules>

<output_contract>
Final response must include:

- Parent Linear issue key and URL.
- Baseline architecture HTML path and Linear attachment/link.
- Final before/after HTML path and Linear attachment/link.
- Completed child Linear issue list.
- Skipped/deferred/blocked candidate list with reasons.
- Commits merged to `master`.
- Push evidence.
- Focused tests run.
- Full gate evidence.
- Review evidence.
- Why the loop stopped.

The completion signal is: the parent Linear issue contains the full loop ledger and artifacts, all completed children contain candidate evidence, final HTML explains before/after and stop reason, `master` is clean/up to date/pushed, candidate worktrees are removed, and no runtime repo-local scratch markdown remains.
</output_contract>
