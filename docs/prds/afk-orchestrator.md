---
slug: afk-orchestrator
linear_project: https://linear.app/kyanite/project/afk-orchestrator-77742470e134
synced_at: 2026-06-04T13:36:44.000Z
source: docs/roadmap.md#afk-orchestrator
status: draft
---
## Problem Statement

Risoluto's current AFK ("away-from-keyboard") engineering path is `/risoluto-goal-run` driving `skills/risoluto-goal-run/references/conductor.workflow.mjs`. That conductor is a Workflow-tool script: it must be handed a *pre-rendered* goal package (waves and issues with their `blockedBy` edges already resolved by `/risoluto-goal-prep`), and it threads every merge and every per-wave gate back through the operator. Three structural limits follow from that design:

1. **It can't react to live execution.** The conductor has no channel into a running coding session — it cannot see a session go idle, hit a permission prompt, start retrying, or stall with a stale todo. It drives by pre-plan, not by observation.
2. **It can't recover from a crash mid-cascade.** State lives in the run, not on disk. If the process dies after three slices have merged and two are in flight, there is no journal to re-derive "what is actually done" from git + session state, so resuming means re-running or hand-reconciling.
3. **Merge/gate orchestration is manual.** Serializing merges into an integration branch, running the full v1 gate per wave, and propagating a blocked slice to its dependents are operator responsibilities today, which defeats the "away-from-keyboard" premise.

Across the AFK-orchestration neighbourhood the bar is an autonomous loop that observes a real execution substrate and is crash-safe by construction. Risoluto already has every upstream piece — a Linear `from:prd-<slug>` issue graph, the `fixer` agent, git worktrees, and the canonical six-command v1 gate — but no standing process that *closes the loop* over them. The gap this fills: turn AFK from a **guided run** (operator in the merge/gate path, no live reaction, no crash recovery) into an **autonomous cascade** (live session events, journal-backed crash recovery, serialized gated merges) that takes a multi-wave PRD to merged without supervision.

## Solution

A standing `scripts/afk-orchestrator/` (run via `tsx`; the repo is `"type":"module"`) that cascades Linear-derived work-slices to merged, unattended:

- **Reads the DAG from Linear directly.** `dag.ts` queries the Linear GraphQL API with `LINEAR_API_KEY` for the `from:prd-<slug>` issues, extracts each issue's `blockedBy` edges, and assigns waves by dependency depth (no pre-rendered goal package required).
- **Drives `fixer` sessions over a live event stream.** Built on `@opencode-ai/sdk` against a long-lived `opencode serve`. Each slice runs in its own git worktree on a `slice/<id>` branch; the orchestrator subscribes to `event.subscribe()` and reacts to `session.idle`, `permission.updated`, `session.status` (`idle | retry | busy`), and `todo.updated`.
- **Is journal-first and crash-safe.** An append-only JSONL journal is the source of truth. On boot and after any SSE reconnect, a reconcile pass re-derives each slice's real state from the journal plus git (`session.status` for liveness, branch commits for progress) and repairs drift — so a mid-cascade crash resumes instead of restarting.
- **Serializes gated merges.** Only `coder` and `reviewer` sessions run in the bounded concurrency pool; *all* merges pass through a single serial mutex executed in a **dedicated integration worktree** (`git -C`, never a checkout in the repo root) into `integration/<slug>`. Each wave ends with the exact six-command v1 gate run directly.
- **Owns the Linear write boundary.** The orchestrator writes per-slice status transitions to Linear live and ticks acceptance criteria under a strict proof-only rule, fully replacing the post-hoc `/risoluto-sync` reconciler. Linear writes are best-effort and non-fatal; the journal remains canon.
- **Is bounded and safe by default.** Permission prompts are auto-allowed only for types *not* listed in `CONTROL.md require_approval_for`; a gated type parks the slice in `awaiting-approval` rather than blanket-allowing. Global wall-clock and total-session budgets halt a runaway cascade.

The observable seam: an operator promotes a PRD, walks away, and returns to an `integration/<slug>` branch with each independently-passing slice merged behind a green gate, Linear reflecting accurate status and only provable acceptance criteria ticked, and a printed `gh pr create` command — or a precise halt summary naming exactly which slice blocked and why.

## User Stories

1. As a Risoluto operator, I want the orchestrator to refuse to start unless `@opencode-ai/sdk` against the installed `opencode serve` proves `event.subscribe`, `session.status`, and `permission.updated` all work, so that an incompatible (slim) opencode build fails at a Wave-0 capability spike with a precise report instead of mid-cascade. *Verifiable: with a stubbed SDK missing `permission.updated`, the spike exits non-zero naming the missing capability and no slice session is spawned.*
2. As a Risoluto operator, I want each work-slice to run in its own git worktree on a `slice/<id>` branch, so that parallel coders never share a checkout. *Verifiable: after two concurrent slices, `git worktree list` shows two distinct paths and each branch has only its own commits.*
3. As a Risoluto operator, I want the wave structure derived from Linear `blockedBy` edges, so that a slice never starts before its dependencies. *Verifiable: a linear A→B→C dependency chain yields three sequential waves; a diamond yields the correct grouping.*
4. As a Risoluto operator, I want a dependency cycle in the Linear graph to fail fast, so that the cascade never deadlocks. *Verifiable: a cyclic `blockedBy` graph makes `dag.ts` throw an error naming the cycle members.*
5. As a Risoluto operator, I want a slice marked done only when its session is idle AND a new commit exists on `slice/<id>` beyond the integration base, so that an idle-but-empty session is never mistaken for completion. *Verifiable: session idle with no new commit → `coder-incomplete`; idle with a new commit → `awaiting-review`.*
6. As a Risoluto operator, I want a coder that goes idle twice without producing a commit to be marked `blocked`, so that a stuck slice can't loop forever. *Verifiable: two idle-no-commit cycles transition the slice to `blocked` and stop re-prompting.*
7. As a Risoluto operator, I want all merges serialized through one mutex in a dedicated integration worktree, so that concurrent merges can't corrupt `integration/<slug>`. *Verifiable: two ready slices observed never merge-interleave; merges occur via `git -C <integration-worktree>`, never a checkout in the repo root.*
8. As a Risoluto operator, I want a merge conflict auto-rebased and retried, and only after persistent failure marked `blocked`, so that routine conflicts don't need me. *Verifiable: an induced conflict triggers `merge --abort` then a rebase-and-retry; a permanent conflict (after the rebase retry cap) ends in `blocked`.*
9. As a Risoluto operator, I want a slice journaled `merged` only after the merge commit is verified reachable from `integration/<slug>`, so that a half-applied merge is never recorded as done. *Verifiable: `git merge-base --is-ancestor <sha> integration/<slug>` must pass before the `merged` journal entry is written.*
10. As a Risoluto operator, I want a busy session whose todo list has been stale past a threshold (and is not in `retry`) handed to a one-shot diagnoser that emits a retry prompt, so that a genuine stall is unstuck without flagging healthy retrying sessions. *Verifiable: busy + stale-todo + not-retry → diagnoser invoked; a session reporting `status: retry` is never flagged.*
11. As a Risoluto operator, I want each per-wave gate to run the exact six v1 commands directly (build, lint, format:check, test, typecheck, typecheck:coverage), fail-fast, so that a wave can't advance on a weaker check than a PR. *Verifiable: a wave with a lint error journals `gate-red` at the lint step and the next wave does not start.*
12. As a Risoluto operator, I want `scripts/afk-orchestrator/` itself covered by build + typecheck, so that the orchestrator's own TypeScript is gated, not just lint/format. *Verifiable: a type error in an orchestrator module fails the gate's typecheck step.*
13. As a Risoluto operator, I want a permission type listed in `CONTROL.md require_approval_for` to park the slice in `awaiting-approval` rather than be auto-allowed, so that an AFK run can't self-authorize a privileged action. *Verifiable: a gated permission type yields an `awaiting-approval` journal entry and no allow call; a non-listed type is auto-allowed.*
14. As a Risoluto operator, I want a `blocked`/`rejected` slice to transitively mark its dependents `blocked` while independent slices in the wave still finish, then halt the cascade at wave end with a summary, so that failures don't silently cascade or strand the run mid-wave. *Verifiable: a blocked slice's dependents are skipped as `blocked`, an independent sibling still reaches `merged`, and the cascade halts at wave boundary with a summary naming the cause.*
15. As a Risoluto operator, I want the `coder`, `reviewer`, and `diagnoser` model ids to be required config with no defaults, so that an unset model fails fast instead of silently picking a wrong/expensive model. *Verifiable: launching with any of the three unset exits before spawning a session, naming the missing model.*
16. As a Risoluto operator, I want a global wall-clock and total-session budget that halts the cascade and journals `aborted-budget` on breach, so that a runaway loop is bounded even without native cost metering. *Verifiable: a tiny `maxTotalSessions` forces an `aborted-budget` halt after the cap.*
17. As a Risoluto operator, I want a killed SSE stream to auto-reconnect and resume tracking the in-flight sessions, so that a transient stream drop doesn't lose the run. *Verifiable: force-closing the event stream once leads to a reconnect, after which the previously-tracked session's `idle` is still handled.*
18. As a Risoluto operator, I want a crash mid-cascade to resume from the journal + git rather than restart, so that completed work is not redone. *Verifiable: with a journal showing one `merged` and one `running` slice, a fresh boot keeps the live `running` session (no duplicate coder) and re-opens a `running` slice whose session is gone.*
19. As a Risoluto operator, I want the orchestrator to write per-slice status to Linear live and tick an acceptance criterion only with a concrete git/test citation, so that Linear reflects reality and never an invented Done. *Verifiable: a criterion with no proving citation is left unticked; status transitions map to the configured Linear workflow states.*
20. As a Risoluto operator, I want a boot/end Linear reconcile pass that re-derives each issue's expected state from journal + git and repairs drift, with Linear write failures non-fatal to the cascade, so that losing `/risoluto-sync` doesn't lose reconciliation and a Linear outage doesn't halt the build. *Verifiable: a drifted issue is repaired from journal+git; an injected Linear API error journals the failure and the cascade proceeds.*
21. As a Risoluto operator, I want a reviewer (a different model) to gate each slice before it enters the merge queue, auto-looping fixes on MEDIUM+ findings and marking `rejected` after the retry cap, so that unreviewed code never merges. *Verifiable: a NONE verdict proceeds to the merge queue; a MEDIUM verdict triggers a fix loop; three failed reviews end in `rejected`.*
22. As a Risoluto operator, I want a `GET /status` HTTP endpoint plus `PATCH` controls to abort a session and skip a wave, and a `CONTROL.md` pause flag honoured at wave boundaries, so that I can observe and steer an AFK run. *Verifiable: `/status` reflects the journal; `PATCH /session/:id/abort` routes to `session.abort` and journals; `paused:true` halts before the next wave.*
23. As a Risoluto operator, I want SIGTERM to flush the journal and shut the HTTP/SSE servers cleanly, so that the journal is always a valid resume point. *Verifiable: SIGTERM exits 0 after the journal is flushed and servers are closed.*
24. As a Risoluto operator, I want the thin `/risoluto-goal-run` launcher to validate the required model ids and `LINEAR_API_KEY`, invoke the orchestrator, tail the journal, and print the `gh pr create` command (never run it), so that opening the PR stays my decision. *Verifiable: with a model unset the launcher reports the precondition failure and does not start the orchestrator; on success it prints, but does not execute, `gh pr create`.*
25. As a Risoluto operator, I want `skills/references/linear-access.md` to own every Linear GraphQL operation (issue- **and** project-level), so that no skill carries an inline mutation that can drift. *Verifiable: `rg 'projectCreate|projectUpdate' skills/risoluto-to-prd/` finds no mutation body; the only definitions live in `linear-access.md`.*
26. As a Risoluto operator, I want `/risoluto-to-prd` to document one parameterized publish path instead of mirrored CREATE/SYNC branches, so that the skill is roughly half its former size with one flow to reason about. *Verifiable: `write.mjs` takes a single `--mode create|sync`; the SKILL.md has one "Publish to Linear" step that branches only on mode; the file is under ~140 lines (was 268).*
27. As a Risoluto operator, I want the duplicated preconditions table, agent-portable Linear block, and reachability invariant extracted into shared `skills/references/` docs that every surviving skill links, so that a change lands once. *Verifiable: `skills/references/{preconditions,reachability}.md` exist; `to-prd`/`to-issues`/`preflight`/`next-bundle` link them rather than restating the rows.*
28. As a Risoluto operator, I want the daemon to be the only build path — the manual single-ticket skills (`tdd`, `pre-pr`, `verify-acceptance`) and the back-half AFK chain (`goal-prep`, the `goal-run` conductor, `review-handoff`, `sync`) retired — so that there is one way to build, not two drifting ones. *Verifiable: after each deletion's wave gate, the named skill directory is absent and no live (non-archived) caller references it.*
29. As a Risoluto operator, I want the TDD red-green-refactor discipline preserved as `skills/references/coder-discipline/` and injected into the daemon's coder prompt, so that retiring the `tdd` skill loses the surface but not the knowledge. *Verifiable: the five discipline files live under `skills/references/coder-discipline/`; the daemon's coder prompt cites them; no skill points at the old `risoluto-tdd/*.md` paths.*
30. As a Risoluto operator, I want each skill deletion gated on the daemon wave that replaces its capability, so that a skill is never removed before its replacement is proven. *Verifiable: `goal-prep`/conductor delete only at Wave 1, `tdd`/`pre-pr` at Wave 2, `review-handoff`/`verify-acceptance`/`sync` at Wave 3; a deletion landing before its wave fails review.*
31. As a Risoluto operator, I want the idempotent back-comment marker convention defined once in `linear-access.md` and reused by every Linear writer (surviving skills and the daemon), so that a re-run never stacks duplicate comments. *Verifiable: the `<!-- risoluto:<kind>[:<key>] -->` convention is defined once; the daemon's Linear writeback and any surviving skill reference it rather than restating it.*

## Implementation Decisions

**Runtime & location.** `scripts/afk-orchestrator/` run via `tsx`. It is dev tooling, not shipped `src/`, but its TypeScript must still be gated — see *Gate coverage*.

**Module boundaries.** One responsibility per module: `index` (entry/wiring), `config` (paths, ports, concurrency cap, required model ids, budgets — fail-fast), `types`, `journal` (append-only JSONL + reducer), `sse` (event stream + reconnect), `reconcile` (boot/reconnect state re-derivation), `linear` (GraphQL read + write + proof-only AC + reconcile), `dag` (Linear edges → waves, cycle detection), `worktree` (worktree/branch lifecycle + integration worktree), `merge-queue` (serial mutex), `merge` (merge/rebase/verify), `coder` (session drive + done state machine + permission policy), `done` (idle-AND-new-commit predicate), `gate` (the six v1 commands), `watchdog` (stall detection), `diagnoser` (one-shot retry-prompt), `reviewer` (different-model review + fix loop), `fixtures` (pre-wave domain fixtures), `control` (`CONTROL.md` pause + approval allowlist), `budget` (wall-clock + session guards), `http` (`/status` + PATCH steering), `cascade` (the orchestration loop), `spike` (Wave-0 capability probe).

**opencode integration (D1).** `@opencode-ai/sdk` against a long-lived `opencode serve`. Because this repo historically drives opencode only via `opencode run` CLI one-shots and may be a customized slim build, a **Wave-0 spike is a hard pre-req gate**: it must prove `event.subscribe`, `session.promptAsync`→`session.idle`, `session.status` shape, and `permission.updated`+allow before any Wave-1 code or the SDK dependency is committed.

**Gate execution & coverage (D2).** `gate.ts` runs the six underlying commands directly and fail-fast: `build → lint → format:check → test → typecheck → typecheck:coverage` (prefixed `CI=true` to avoid the no-TTY pnpm abort). It must **not** shell out to a `v1-check` script — `v1-check` is a Claude skill, not a pnpm script. The repo `tsconfig.json` (`rootDir:"src"`, `include:["src/**/*"]`) excludes `scripts/`, so a dedicated typecheck project must add `scripts/afk-orchestrator/**/*` to genuinely build/type-gate the orchestrator (today only lint/format touch `scripts/`).

**Merge model (D3).** Concurrency pool holds only `coder` + `reviewer`. Merges serialize through one mutex in a dedicated integration worktree via `git -C` — never `git checkout` in the repo root. Conflict path: `merge --abort` → rebase the slice branch on the integration branch → retry; persistent conflict (after cap) → `blocked`. A `merged` entry is journaled only after `git merge-base --is-ancestor` confirms reachability.

**DAG source (D5).** `dag.ts` calls Linear GraphQL directly (`LINEAR_API_KEY`) for `from:prd-<slug>` issues and their `blockedBy`; waves by dependency depth (port the `readyIn` logic from the existing `conductor.workflow.mjs`); cycles throw.

**Models (D6).** `coder`, `reviewer`, `diagnoser` are config-only, no defaults, fail-fast if unset. The reviewer is a *different* model from the coder (cross-model review).

**Done predicate (D7).** `done = session idle AND a new commit on slice/<id> beyond the integration base`. No "working-tree diff non-empty" clause — the commit-before-idle contract makes the working tree empty by design.

**Failure propagation (D8).** A `blocked` (2 coder-incomplete) or `rejected` (3 failed reviews) slice transitively marks dependents `blocked`; independent slices in the wave still finish; the cascade then halts at wave end with an operator summary.

**Permission safety (D4).** Honour `CONTROL.md require_approval_for`: auto-allow only non-listed types; a listed type journals `awaiting-approval` and holds (never blanket-allow).

**Budgets (D9).** Config-driven max cascade wall-clock and max total sessions (coder/reviewer/diagnoser spawns counted); breach → halt + `aborted-budget`.

**Linear write boundary (D10) & AC discipline (D11).** The orchestrator writes per-slice status transitions live and ticks acceptance criteria, **fully replacing `/risoluto-sync`**. AC ticking is proof-only — a criterion is ticked only with a concrete git/test citation, never invented from a bare `merged`. A boot/end reconcile pass re-derives expected Linear state from journal+git and repairs drift. All Linear writes are non-fatal; the journal is canon. This roughly doubles the Linear surface area relative to the original plan and is the single largest scope item — it absorbs `/risoluto-sync`'s hardest logic.

**Thin launcher.** `skills/risoluto-goal-run/SKILL.md` becomes a thin launcher (validate required models + `LINEAR_API_KEY` → run orchestrator → tail journal → print `gh pr create`). `conductor.workflow.mjs`'s `readyIn` logic is ported into `dag.ts`, after which the conductor file is **deleted** (Wave 1) — the daemon is the only build path, so nothing else consumes it.

**Pipeline skill restructure (D12).** This PRD is the umbrella for both the daemon and the pipeline-skill simplification. The daemon is the **only** build path: the manual single-ticket path (`tdd`, `pre-pr`, `verify-acceptance`) and the back-half AFK chain (`goal-prep`, the `goal-run` conductor, `review-handoff`, `sync`) are retired, their capabilities living inside the daemon (`coder`, `reviewer`, `gate`, live writeback + reconcile). Shared concerns consolidate into `skills/references/`: `linear-access.md` owns all Linear GraphQL (issue + project) and the back-comment marker convention; `preconditions.md` and `reachability.md` hold the formerly copy-pasted gate and invariant; `coder-discipline/` holds the relocated TDD discipline the coder prompt injects. Every deletion is gated on the daemon wave that proves its replacement (see [Pipeline Skill Restructure](#pipeline-skill-restructure)). Survivors (`to-prd`, `to-issues`, `preflight`, `next-bundle`, the thin launcher) keep their identity and only delegate to the shared refs; no skills are merged. `architecture-loop` stays out of scope — it only repoints its discipline reference.

## Pipeline Skill Restructure

The umbrella's second half. Because the daemon collapses the back-half of the planning pipeline, the surrounding skills are simplified in the same initiative. The end-state build pipeline is `to-prd → to-issues → preflight → goal-run (thin launcher) → [afk-orchestrator daemon] → operator opens PR` — down from a ten-skill manual+AFK tangle.

**Daemon is the only build path.** The manual single-ticket path and the old AFK conductor are both retired; their capabilities move in-process into the daemon's `coder`, `reviewer`, `gate`, and live Linear writeback/reconcile modules. There is no remaining way to hand-build and reconcile a single ticket outside a cascade — by design. The goal-level cross-model review that `review-handoff` provided collapses into the daemon's per-slice `reviewer`.

**Shared references (`skills/references/`).** The duplicated concerns are extracted so a change lands once:

| Reference | Owns | Replaces copies in |
| --- | --- | --- |
| `linear-access.md` | every Linear GraphQL op (issue + project) and the idempotent back-comment marker convention | inline `projectCreate`/`projectUpdate` in `to-prd`; the marker convention formerly restated in `tdd`/`sync`/`review-handoff` |
| `preconditions.md` | repo-root / `research/` init / Linear-reachable / clean-tree gate | the per-skill preconditions tables |
| `reachability.md` | the non-test-caller invariant (a green gate is not reachability) | the five skills that each restated it |
| `coder-discipline/` | the relocated red-green-refactor discipline (`tests`, `interface-design`, `refactoring`, `mocking`, `deep-modules`) | `risoluto-tdd/*.md`; injected into the daemon coder prompt |

**Deletion set — each gated on the daemon wave that replaces it** (never delete-before-replace):

| Skill / file | Replaced by | Gate |
| --- | --- | --- |
| `risoluto-goal-prep` (+ `render.mjs`, templates) | live Linear DAG read (`dag.ts`) | Wave 1 |
| `goal-run` conductor (`conductor.workflow.mjs`) | `cascade.ts` + `dag.ts` `readyIn` port | Wave 1 |
| `risoluto-tdd` (skill) | daemon `coder` (the discipline files survive as references) | Wave 2 |
| `risoluto-pre-pr` | daemon `reviewer` + `gate` | Wave 2 |
| `risoluto-review-handoff` | daemon per-slice `reviewer` | Wave 3 |
| `risoluto-verify-acceptance` | daemon `reviewer` + proof-only AC writeback | Wave 3 |
| `risoluto-sync` | daemon live writeback + boot/end reconcile | Wave 3 |

**Survivors get a DRY pass only — no merges.** `to-prd` (slim + unified CREATE/SYNC), `to-issues`, `preflight`, and `next-bundle` keep their boundaries and link the shared refs; the new thin `goal-run` launcher is a Wave-1 deliverable. The independent restructure work (extracting the references, slimming the survivors, relocating the discipline) is **Wave 4** and carries no daemon dependency — only the deletions above wait on their gates.

## Testing Decisions

The orchestrator's external behaviour — not its internals — is what tests must pin, because the whole value proposition is "does the loop reach the right terminal state under adverse events." Good tests here:

- **Drive the state machine through mocked SSE event sequences** and assert journal transitions: idle-no-commit → `coder-incomplete`; idle+commit → `awaiting-review`; gated permission → `awaiting-approval` with no allow; error-during-retry ignored. The SSE layer is tested with a mocked async iterable, including a thrown stream that must reconnect and resume tracking.
- **Use a temp git repo fixture** for worktree/merge/done behaviour: add-then-remove leaves `git worktree list` clean; `hasCommit` is false before and true after a commit; a clean merge, an auto-rebased conflict, and a persistent-conflict→`blocked` are all asserted; the `merged` entry appears only after the ancestry check; concurrent merge calls are observed to serialize.
- **Assert reconcile from a synthesized journal+git state**: running+alive kept (no duplicate coder), running+gone re-queued, merged-but-not-in-git re-opened, drifted Linear issue repaired.
- **Treat Linear as an injected client**: status mapping per transition is asserted; an injected API error is non-fatal (cascade proceeds, failure journaled); an AC with no citation is never ticked; reconcile flags a checked-without-proof criterion.
- **The gate and budget are behavioural**: a forced lint failure stops the next wave (`gate-red`); a tiny session budget forces `aborted-budget`.

Prior-art shape to follow: the existing skill scripts and `src/orchestrator/` use small, pure, dependency-injected units with vitest specs per module; mirror that — no network, no real `opencode serve`, no real Linear in unit tests. The Wave-0 spike and a full multi-wave synthetic-PRD dry run are the integration tiers (one induced SSE drop, one induced merge conflict, one induced stall, all auto-recovered).

## Out of Scope

- **Native cost/token metering.** Budgets are wall-clock and session-count only; there is no per-token accounting.
- **Multi-PRD / multi-slug concurrency.** One `<slug>` cascade per orchestrator process.
- **Opening the PR.** The orchestrator (and the thin launcher) print `gh pr create`; they never run it (memory: skills-no-auto-pr).
- **Goal-package rendering.** The DAG is read live from Linear; `/risoluto-goal-prep`-style pre-rendered packages are not required or produced.
- **Replacing the v1 gate definition.** The orchestrator *runs* the existing six commands; it does not redefine what the gate is.
- **A UI beyond the minimal `/status` + PATCH HTTP surface.** No dashboard.
- **Retaining the manual build path.** `/risoluto-sync`, `/risoluto-verify-acceptance`, `/risoluto-pre-pr`, `/risoluto-tdd`, `/risoluto-review-handoff`, `/risoluto-goal-prep`, and the `goal-run` conductor are all retired — their capabilities move into the daemon (see [Pipeline Skill Restructure](#pipeline-skill-restructure)). The boot/end reconcile pass is the only reconciliation safety net and carries `/risoluto-sync`'s proof-only discipline.
- **Merging or redesigning surviving skills.** The restructure is DRY-only on survivors (`to-prd`, `to-issues`, `preflight`, `next-bundle`); none are merged. `risoluto-architecture-loop` keeps its own identity — only its discipline reference is repointed to `coder-discipline/`.

## Further Notes

- **Sequencing.** Wave 0 = the SDK capability spike (gates everything; SDK dep added only once green). Wave 1 = minimal end-to-end (journal + SSE + `/status`; Linear read + DAG; worktree lifecycle; single-slice runner; thin launcher) to first `awaiting-review`. Wave 2 = cascade + robustness (serial merge; watchdog + diagnoser; multi-wave loop + gate + budget; crash recovery). Wave 3 = quality + Linear ownership (reviewer + auto-fix; domain fixtures; HTTP steering + pause + SIGTERM; Linear writeback + proof-only AC + reconcile). Wave 4 = the pipeline skill restructure's **independent** work (extract the shared `skills/references/`, slim `to-prd`/`to-issues`/`preflight`/`next-bundle`, relocate the coder discipline, write the thin launcher); the skill **deletions** in the Pipeline Skill Restructure table are exit criteria on Waves 1–3, not Wave 4, so a capability is never removed before its replacement ships.
- **Hard external preconditions** beyond the spike: required model ids before the coder/watchdog/reviewer items; `LINEAR_API_KEY` before the DAG and Linear-writeback items.
- **Risk to watch.** The Linear writeback + proof-only AC + reconcile item (D10/D11) roughly doubles the Linear surface area and folds in `/risoluto-sync`'s hardest logic; track it as a first-class item, not a side effect.
- **Open question.** The exact mapping from slice statuses to the Ninetech team's Linear workflow states (`running→In Progress`, `awaiting-review→In Review`, `merged→Done`, `blocked/rejected→?`) should be config-driven and confirmed against the live workflow before the writeback item lands.
