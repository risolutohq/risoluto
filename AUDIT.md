# Risoluto Repo Audit — 2026-06-10

Audited at commit `3a5ea94` on `master`. Method: the repo's own verification commands were actually run (outcomes quoted below), three discovery agents mapped the repo, seven dimension auditors reviewed it in parallel, and every finding originally rated High was attacked by a fresh-context refuter agent before entering this report. Every `file:line` cited here was opened during this audit session. Findings the refuters killed or downgraded are reported at their post-refutation severity, with the refutation evidence noted.

---

## 1. Executive Summary

**Health grade: B+** (calibrated to a 15-day-old, single-maintainer, pre-1.0 product — not to enterprise rigor).

This is an unusually disciplined codebase for its age. The full canonical gate (build → lint → format → reach:check → test → typecheck → type-coverage ≥ 95%) passes in about 45 seconds, CI runs that same gate plus integration and e2e tiers on every PR with SHA-pinned actions, the security posture survived a dedicated audit with only two modest findings, and source typing has literally zero `any` / `@ts-ignore`. The grade is pulled down from A territory by three structural debts, all of which compound with time.

**Top 3 risks:**

1. **Run-identity drift.** The product spine declares Workflow Run the core primitive, but SQLite persistence is still keyed off `attempt_id`/`issue_id` with no `workflow_run_id` column anywhere in the schema (`src/persistence/sqlite/schema.ts:16-18`). Live state is mutated in place (`updateAttempt`) rather than projected, and dispatch defaults to in-process. The ADR honestly labels all three "⚠ Drifted" — but every new feature built on the old identity makes the migration more expensive.
2. **`src/workflow-run/` accretion.** 50 files / 7,975 lines in one flat directory that is simultaneously the highest-churn module, the highest bug-fix-density module, and the only place where files were created-then-deleted within the repo's 15-day life. The seams _into_ it hold; the lack of boundaries _inside_ it is where defects concentrate.
3. **Silent fail-closed paths + no stuck-run sweep.** Several completion-path failures are swallowed without a log line, and nothing ever re-drives a run stuck in `accepted`. Each individual case fails in the safe direction (verified by refuters), but for an AFK orchestration tool, "safe but invisible" means the operator wakes up to a done-but-unmerged PR or a stalled run with no diagnostic trail.

**Top 3 opportunities:**

1. **Wire the already-installed safety tools into CI.** `knip` and `madge` both exist, both currently fail (6 dead-code items, 1 type-only cycle), and neither runs in CI. Fixing the findings and gating them is a small task with permanent payoff.
2. **One archive-hardening PR.** Atomic metadata writes, one unguarded `JSON.parse`, an in-memory sequence counter, and pagination on two endpoints — four verified weaknesses, all in `src/workflow-run/archive.ts`, fixable together.
3. **Cheap observability wins.** Log the swallowed non-ENOENT branches, surface the discarded auto-merge result, add pino's native `redact` backstop. Hours of work that directly serve the AFK use case.

---

## 2. Repo Map

**Purpose.** Workflow-run-centered background agent orchestration for a solo operator running autonomous coding agents (AFK/overnight). Any engineering intent (Linear ticket, CLI command, webhook, Slack modal) becomes a durable, retryable Workflow Run executed by agent roles (planner, implementer, reviewer, verifier). CLI is the primary surface; the HTTP API is support/internal; web frontend is explicitly out of scope.

**Scale and cadence.** ~55,440 LOC of source TypeScript across 396 files in 33 `src/` modules; ~97,328 LOC across 388 test files (1.8 : 1 — mostly depth, not padding; see §3.4). First commit 2026-05-26; 280 commits in 15 days; one contributor. Zero TODO/FIXME comments in src/. `quarantine.json` exists, is empty, and has never held an entry.

**Entry points.**

- `bin/risoluto` → `dist/cli/index.js`. `main()` in `src/cli/index.ts:50` initializes config + secrets + SQLite, builds all services via `createServices()` (`src/cli/services.ts` — a 596-line composition root organized into named phases, with no business logic; verified clean), then starts orchestrator, PR monitor, automation scheduler, alert engine, and HTTP server.
- HTTP: `src/http/server.ts` (Express 5), loopback-bound by default, refuses non-loopback bind without auth tokens.
- Webhooks: `src/webhook/` (Linear, GitHub, Slack handlers) → intake.
- Optional remote data plane: `src/dispatch/entrypoint.ts` (`DISPATCH_MODE=remote`), a control-plane/data-plane split that is wired and functional but undocumented.

**Core flow.** Intake (`acceptWorkflowRunIntake` in `src/workflow-run/intake-core.ts`) → file-based archive (`src/workflow-run/archive.ts` — run metadata, artifacts, `events.jsonl` per run) → orchestrator tick → `driveAcceptedWorkflowRun` (`src/workflow-run/drive-accepted-run.ts`) → state-machine executor (`src/workflow-run/executor.ts`) → role execution via Docker Codex sessions (`src/agent-runner/`, `src/codex/`) → tracker mirroring as a projection (`src/workflow-run/status-mirror.ts`). SQLite (`src/persistence/sqlite/`) stores attempts, cost samples, health probes — note the run archive itself is files, not SQLite.

**Conventions actually held in code (verified by sampling, not just declared):** ports-and-adapters naming (10 `port.ts` files, `*-adapter.ts` implementations, barrel `index.ts` files exporting only public surface); custom error classes + `toErrorString` at every catch; pino with structured fields only (no string interpolation found); complexity ceiling 15; `import type` discipline.

**Surprises worth knowing:**

- The remote dispatch mode (`src/dispatch/factory.ts:34`, `DISPATCH_MODE=remote`) is fully wired but appears in no documentation.
- `src/live/` is not a "live mode" — it's a deployment preflight checker consumed by the live test tier and `risoluto doctor --live`.
- All "possibly vestigial" modules (`codex`, `agent`, `agent-runner`, `automation`, `audit`, `live`, `alerts`) were traced to production import chains from the CLI entry point — none are orphaned.
- CI runs most jobs on Node 24 while the documented floor is Node 22 (only the `test` job runs a 22+24 matrix). Cosmetic, but the floor isn't what most jobs exercise.

**Observed command outcomes (run during this audit, 2026-06-10):**

| Command                                                                                      | Outcome                                                                                              |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm run build / lint / format:check / reach:check / test / typecheck / typecheck:coverage` | **All pass** (8s / 1s / 1s / 4s / 16s / 7s / 8s)                                                     |
| `pnpm audit`                                                                                 | **No known vulnerabilities**                                                                         |
| `pnpm outdated`                                                                              | 5 dev deps behind by minor/patch only                                                                |
| `pnpm run slug:check`                                                                        | OK — 4 PRD slugs consistent                                                                          |
| `pnpm run knip`                                                                              | **FAIL** — 1 unused file, 1 "unused" dep (false positive, see §3.7), 3 unused exports, 1 unused type |
| `pnpm run circular` (madge)                                                                  | **FAIL** — 1 cycle (type-only, see §3.7)                                                             |

**What was skipped:** the live tier (`test:integration:live` needs real API credentials), `test:docker`, `test:load` (it measures mocks — see finding M-8), mutation testing, and deep review of `src/github/`, `src/notification/`, `src/setup/`, `src/state/` beyond the security pass. The audit went deep on the core ~20%: `workflow-run`, `workflow-definition`, `orchestrator`, `cli`, `persistence`, `http`/`webhook`, `dispatch`, plus CI/config.

---

## 3. Audit Report (worst first)

Severity after adversarial verification. "Fact" = directly observed in code/output; "Judgment" = evidence-based assessment.

### 3.1 Architecture

**H-1 — Persistence and dispatch still run on the legacy attempt/issue identity, not Workflow Run identity.**
_Where:_ `src/persistence/sqlite/schema.ts:16-18` — `attempts` table primary-keyed on `attempt_id` with `issue_id NOT NULL`; zero `workflow_run_id` references in the schema (verified by direct grep). `src/persistence/sqlite/attempt-store-sqlite.ts:78` — `updateAttempt()` mutates rows in place, the parallel mutable write that ADR-0001 §4 ("live state is a projection") exists to prevent. `src/dispatch/factory.ts:34` — `DISPATCH_MODE ?? "local"`, vs §6's "network-shaped by default".
_Why it matters:_ This is the declared core architectural decision of the product (Workflow Run as primitive) not yet reflected in the durable layer. Every attempt-keyed feature added now increases migration cost; queries joining run state to attempt state must go through application-level correlation.
_Severity:_ **High** | _Confidence:_ High | _Fact._ Survived verification — the ADR itself labels all three rows "⚠ Drifted" (this is honest, sequenced debt, not hidden drift), but it remains the largest gap between declared architecture and code.

**H-2 — `src/workflow-run/` is a 50-file flat module with no internal boundaries, and it is where the defects live.**
_Where:_ 50 files / 7,975 LOC (verified by count). Intake (`intake-core.ts`, `linear-intake.ts`, `tracker-intake.ts`, `slack-interactions.ts`), engine (`executor.ts` 455L, `drive-accepted-run.ts` 558L, `run-role-runner.ts`), archival (`archive.ts`, `evidence-store.ts`), gates/verification (`gate-hook-engine.ts`, `post-publish-verifier.ts`), and workspace lifecycle all cohabit one directory with nothing preventing cross-concern imports.
_Why it matters:_ Three independent data sources converge on this module: highest churn (`drive-accepted-run.ts` and `artifact-contracts.ts`, 15 changes each in 15 days), highest fix density (`intake-core.ts`: 6 fix commits), and the only architectural thrash in the repo (4 files created-then-deleted: `role-execution-artifacts.ts`, `run-attempts.ts`, `worker-process.ts`, `workspace-lifecycle.ts` — the last deleted and recreated). The module grows by accretion; a sub-boundary would make the executor unable to silently reach intake or archival internals.
_Counter-evidence (noted for fairness):_ the seams _into_ the module hold — CLI/HTTP/Slack all funnel through `acceptWorkflowRunIntake` / `driveAcceptedWorkflowRun`, and no adapter reaches into engine internals.
_Severity:_ **High** | _Confidence:_ High | _Judgment_ (the facts are verified; "this will keep costing you" is the judgment).

**M-1 — `eventBus` is optional in HTTP route deps; a missing bus would strand runs in `accepted` forever, and nothing would ever notice.**
_Where:_ `src/http/route-types.ts:33` (`eventBus?:`), `src/http/routes/workflow-runs.ts:126` (`deps.eventBus?.emit("workflow_run.accepted", ...)`). Refuter-verified context: production always wires the bus (`src/cli/services.ts:443-455`), so the stall is **not reachable today** — hence Medium, not the original High. But: `src/http/dep-validator.ts:29` only warns; `src/orchestrator/recovery.ts` operates on attempt statuses and has **no sweep for runs stuck in `accepted`**; and the e2e test (`tests/e2e/http-webhook.e2e.test.ts:193`) constructs `HttpServer` without the constructor-level `eventBus`, so a future mis-wiring would pass CI.
_Why it matters:_ A one-line refactor away from a silent, permanent, log-free stall on the primary HTTP intake path.
_Severity:_ **Medium** | _Confidence:_ High | _Fact._ (Downgraded from High by refutation.)

**M-2 — `slack-interactions.ts` is both a Slack intake adapter and an engine policy contract in one file.**
_Where:_ `src/workflow-run/slack-interactions.ts` — `acceptSlackModalWorkflowRun` is called from `src/webhook/slack-handler.ts:135` (intake), while `decideUnansweredSlackClarification` is injected into the driver (`src/workflow-run/workflow-run-driver.ts:53`), and `executor.ts:5` imports types from it.
_Why it matters:_ The engine indirectly depends on Slack intake code — the sharpest single symptom of H-2's missing boundaries.
_Severity:_ **Medium** | _Confidence:_ High | _Fact._

**Healthy:** layering discipline is otherwise strong — `services.ts` is a clean composition root, downstream modules access persistence only through ports, and the CLI's direct SQLite imports are defensible composition-root behavior (`src/cli/index.ts:13-14`).

### 3.2 Correctness & code quality

**M-3 — The archive has four verified hardening gaps around crash/corruption.**
_Where (all `src/workflow-run/archive.ts`, all read this session):_

- `:247` — `readWorkflowRunEventsFromRunDir` parses `events.jsonl` with **no** try/catch (unlike its sibling at `:208-212`); a crash mid-`appendFile` leaves a truncated last line whose raw `SyntaxError` propagates into the next append via the sequence computation.
- `:124, :299` — run metadata is written with in-place `writeFile`, not temp-file+rename; a crash mid-status-update leaves a partial `metadata.json`, which `listWorkflowRunsInArchive:149-154` then silently drops from listings (run disappears).
- `:216-219` — every event append re-reads and re-parses the **entire** event log just to compute `max(sequence)+1`.
- `:209, :311, :363` — reads cast parsed JSON without shape validation. Refuter-verified mitigation: artifacts are Zod-validated at **write** time (`:254` via `parseWorkflowRunArtifact`) and parse failures are wrapped in `WorkflowRunArchiveParseError`, so this last item alone is Low; the first two are the real exposure.
  _Severity:_ **Medium** | _Confidence:_ High | _Fact._ (Downgraded from High: write-time validation and ParseError wrapping cover the headline scenarios.)

**M-4 — Fail-closed completion paths are invisible to the operator.**
_Where:_

- `src/workflow-run/drive-accepted-run.ts:496-500` — `updatePublishResultUrl` swallows **all** read errors (not just ENOENT, breaking the codebase's own ENOENT-discrimination idiom); the PR URL is never stamped and auto-merge blocks.
- `src/cli/run-start-command.ts:270` — the `AutoMergeCompletionResult` return value is discarded entirely, so a blocked auto-merge (`"auto_merge_publish_not_ready"`, `"post_publish_verifier_not_satisfied"`) produces no log, no Linear comment, no handoff record.
- `src/cli/services.ts:283-285` — bare `catch { return undefined; }` in `resolveWorkflowStatusMapping` swallows EACCES/corrupt-JSON alongside the expected ENOENT, silently degrading tracker status projection.
  _Why it matters:_ Refuters confirmed every one of these fails in the safe direction (no unintended merge, conservative fallback). But the operator's experience is a "done" run with an unmerged PR and zero diagnostic trail. For an AFK tool, observability of safe failures is a feature requirement, not polish.
  _Severity:_ **Medium** | _Confidence:_ High | _Fact._ (Each item downgraded from High by refutation; one related claim — that a skipped verification reconfirm could let auto-merge proceed on a stale verdict — was **refuted outright**: the gate at `src/workflow-run/auto-merge-completion.ts:109-116` requires `postPublishReconfirm.decision === "satisfied"` and blocks when reconfirm never ran.)

**M-5 — `executeWorkflowDefinition` is the hardest function in the codebase to modify safely.**
_Where:_ `src/workflow-run/executor.ts:109-171` — the main loop mutates `index` directly while three retry counters (`gateRetryAttempts`, `verifierRetryAttempts`, `clarificationRetryAttempts`) interact indirectly; `verifierRetryAttempts` doubles as the `attempt` parameter for before-state gates (`:301`).
_Severity:_ **Medium** | _Confidence:_ Medium | _Judgment._ It passes the complexity-15 lint ceiling; the cost is cognitive, not cyclomatic.

**Low (verified facts, quick to fix):** duplicated 1-second ENOENT polling loops at `src/workflow-run/intake-core.ts:251-265` and `:273-290` (both carry RIS-261/263 rationale comments — deliberate, just copy-pasted); `rawPublish["mode"] as PrPublishMode` at `drive-accepted-run.ts:451` (refuter-verified harmless today: garbage modes fall through `post-publish-verifier.ts:62-64` to a conservative skip, and the value is in-process Zod-typed — use `safeParse` anyway); the JSONL deprecation warning branch at `src/cli/index.ts:156-160` (intentional, will need an eventual removal date).

### 3.3 Testing

**M-6 — The two unit tests for `driveAcceptedWorkflowRun` mock out the core driver, leaving the full wiring to a single integration test.**
_Where:_ `tests/workflow-run/drive-accepted-run-memory.test.ts:9` and `drive-accepted-run-publish.test.ts:9` both `vi.mock` `driveWorkflowRun`; the real coordination is held by `tests/cli/accepted-run-driver-done-handoff.integration.test.ts:160-177` (which does gate CI). Similarly, `tests/agent-runner/turn-executor.test.ts:4-50` mocks all six collaborators of the hot-path turn loop and asserts only mock interactions.
_Why it matters:_ This is exactly the repo's own documented failure mode ("green gate while features wired only in tests"). The integration tier catches the main path, but the margin is one test.
_Severity:_ **Medium** | _Confidence:_ High | _Fact._

**M-7 — 66 copy-pasted `createTempDir` helpers across test files.**
_Where:_ 66 independent definitions of the same ~10-line mkdtemp/cleanup pattern (e.g. `tests/workflow-run/archive.test.ts:12-20`, `tests/workflow-run/intake-core.test.ts:19-27`); `tests/helpers.ts` (56 lines) has no `withTempDir`, and `tests/helpers/` hasn't been touched since the initial scaffold.
_Severity:_ **Medium** | _Confidence:_ High | _Fact._ The single largest maintenance liability in the test codebase.

**M-8 — The load-test tier both never runs and measures nothing real.**
_Where:_ No CI workflow invokes `test:load` (verified by grep over `.github/workflows/`). Independently, `tests/http/load.test.ts:24-83` fully mocks the orchestrator and bypasses the rate limiter — its p99 < 200ms assertion measures Express routing overhead, not the archive-backed endpoints that actually scale with run count (see M-9).
_Severity:_ **Medium** | _Confidence:_ High | _Fact._ (Two auditors' findings merged; the "absent from CI" half was originally rated High but the mock-only half refutes its urgency — fix what it measures before wiring it in, or delete it.)

**Low:** e2e tier is real and gates CI but covers only 3 happy paths (one per intake surface) — the `blocked` path, duplicate external objects, and budget exhaustion are untested end-to-end; three `expect(...).toBeDefined()` assertion-noise spots in `tests/agent/json-rpc-connection.test.ts:274,541,556`; live tier gates nothing per-PR by design (nightly `live-smoke` only, `live-preflight` is `continue-on-error` — `ci.yml:110,176`).

**Strengths to protect:** `tests/workflow-run/executor.test.ts` exercises the real state machine with no mocks (DAG ordering, status sequences, retry loops, budget exhaustion); `intake-core.test.ts` and `archive.test.ts` run against real tmpdir-backed stores; the e2e harness asserts on archived artifacts and includes a deliberate "bites" test proving its assertions can fail. CI runs unit + integration + e2e on every PR across a Node 22/24 matrix.

### 3.4 Performance

(Calibrated to a single-operator tool at hundreds of runs / thousands of events.)

**M-9 — Archive-backed HTTP endpoints scale linearly with total run count, with no pagination anywhere.**
_Where:_ `src/workflow-run/archive.ts:132-161` — `listWorkflowRunsInArchive` does `readdir` + one `readFile`+`JSON.parse` per run directory on **every** call to `GET /api/v1/workflow-runs` (`src/http/routes/workflow-runs.ts:61`), no cache, no limit parameter. `archive.ts:196-213` — the events endpoint returns the entire parsed `events.jsonl` in one response. Combined with the append-path full-scan (M-3), these compound as runs accumulate.
_Severity:_ **Medium** | _Confidence:_ High | _Fact._

**Healthy otherwise:** no sync I/O on hot async paths, in-memory keyed-serial-chain maps self-evict, retry logic has a proper 30s cap with jitter (`src/utils/retry.ts`). Low-severity N+1s noted and deliberately not queued: `fetchIssuesByNumbers` fires one GitHub REST call per issue (`src/github/issues-client.ts:228-233` — REST has no batch endpoint) and nightly Linear recovery is per-entry (`src/linear/nightly-failures.ts:138-150`).

### 3.5 DevEx & ops

**M-10 — Release automation is configured but unreachable, and AGENTS.md claims it works.**
_Where:_ `.releaserc.yml` targets `branches: ["main"]` while the repo's default branch is `master`; no CI workflow invokes semantic-release (verified by grep over `.github/`); the only tag is a manual `v0.1.0`. AGENTS.md states "semantic-release (`.releaserc.yml`) handles changelog + git tagging."
_Severity:_ **Medium** | _Confidence:_ High | _Fact_ (verified directly this session; one auditor claimed the file didn't exist — it does, which is why this is a two-line fix or a deliberate removal).

**M-11 — No transport-layer redaction backstop in the logger.**
_Where:_ `src/core/logger.ts:29-41` — `basePinoOptions()` sets no `redact` paths; all secret-safety relies on call-site discipline and `content-sanitizer.ts`. One unsanitized `logger.error({ config })` anywhere leaks verbatim to stdout.
_Severity:_ **Medium** | _Confidence:_ High | _Judgment_ (app-layer sanitization is genuinely thorough; this is defense-in-depth).

**Low:** `post-merge.yml` pushes directly to master with `contents: write` — but it validates the slug, fails loudly, and aborts before the Linear update on push failure (`.github/workflows/post-merge.yml:68-70`; the original "silently fail" claim was wrong). `.gitleaks.toml` is a one-line stub (no allowlists, default rules only). `.husky/pre-commit:6` exits on `SKIP_HOOKS=1` and soft-skips gitleaks when the binary is missing — CI gitleaks still catches it, but after the commit lands in history. `docs-ci.yml:21-22` uses mutable `@v4` action tags while every other workflow SHA-pins. No bare-host supervision story (Docker path has `restart: unless-stopped`; direct CLI runs have nothing). `knip`/`madge`/`mutate` never run in CI.

### 3.6 Security

**Healthy — the strongest dimension.** Verified specifics: main HTTP server defaults to `127.0.0.1` and refuses non-loopback bind without `RISOLUTO_READ_TOKEN`, with timing-safe token comparison; Slack webhook verifies HMAC with `timingSafeStringEqual` and a 300-second replay window before any parsing, and the route isn't even registered without a signing secret; all subprocess invocations use argv arrays (`execFileAsync`, no `shell: true`) with branch names validated against git ref-format rules; workspace paths are sanitized and prefix-checked (`src/workspace/paths.ts`, `src/docker/workspace-mounts.ts` via `realpath` + `gitBaseDir` containment); all SQL is parameterized; secrets use AES-256-GCM with scrypt, 0600 file mode, atomic rename; outbound URLs pass SSRF guards blocking private ranges. `pnpm audit` is clean.

**M-12 — The remote data-plane binds `0.0.0.0` non-configurably, with an unauthenticated `/health`.**
_Where:_ `src/dispatch/entrypoint.ts:16` (`app.listen(PORT, "0.0.0.0", ...)`, no env override), `src/dispatch/server.ts:55-61` (`GET /health` without `bearerAuth`, leaking liveness + active dispatch count). Mutations are bearer-gated and the process refuses to start without `DISPATCH_SHARED_SECRET`.
_Severity:_ **Medium** (Low if it only ever runs in a container, which appears to be the intent) | _Confidence:_ High | _Fact._

**Low:** `src/persistence/sqlite/database.ts:299` interpolates table/column identifiers into DDL — every current caller passes hardcoded literals; add an identifier allowlist if the function ever takes derived input.

### 3.7 Dependencies

**Healthy.** Lockfile committed (290 KB, current); `pnpm audit` clean; only 5 dev deps behind by minor/patch; the three `overrides` (`flatted`, `path-to-regexp`, `qs`) are deliberate security floors; runtime dep list is small and modern (Express 5, Zod 4, Drizzle, better-sqlite3, pino). Two genuine items from the tools: the knip findings are real dead code (`src/persistence/sqlite/query-helpers.ts` — a `@deprecated` migration residue with zero importers; dead exports `slackIntakeConfigSchema` at `src/config/schemas/server.ts:103`, `readNightlyFailureSummary` at `src/linear/nightly-failures.ts:346`, `defaultHistoryPath` at `src/linear/nightly-history.ts:99`; dead type `CreateWorkflowRunBody` at `src/http/request-schemas.ts:95`) — **except** `@aws-sdk/client-s3`, which knip wrongly flags: it's used by `scripts/upload-nightly-artifacts-r2.ts` and `scripts/nightly-history-r2.ts` (knip's entry config just doesn't include `scripts/`). The madge cycle (`intake-core.ts` ↔ `intake-idempotency-store.ts`) is `import type` in the back direction — erased at compile, zero runtime risk; moving two types to `contracts.ts` clears it.

### 3.8 Docs vs reality

**Healthy — unusually so.** The docs auditor extracted 39 strong factual claims across 8 docs and verified 33 true, with the ADR status tables accurately self-reporting their own drift (that drift is finding H-1, not a docs problem). Previously-reported fixes were re-verified as real: `withRetry` now rethrows the final error (`src/utils/retry.ts:51-53`), the Codex request handler has explicit deny paths (`src/agent/codex-request-handler.ts:68-69`), the reachability manifest has 13 entries with `reach:check` in the CI quality job. Remaining nits (all Low): `docs/testing-and-release.md:104` overstates lint-staged's `oxlint --fix` scope (`.lintstagedrc.json` applies it to `.ts` only); `docs/technical-spine.md:127` calls the GitHub adapter "shipped" without product-spine's "but incomplete" qualifier (`src/tracker/github-adapter.ts:139` throws on project provisioning); CONTEXT.md's canonical term "Engineering Intent" appears nowhere in src/ (code says `WorkflowRunIntentArtifact` / `intent.v1`), despite the glossary's "the code is wrong" rule.

---

## 4. Improvement Strategy

Four themes explain nearly all of the above.

**Theme 1 — Make safe failures visible.** (M-1, M-4, M-11; serves the AFK mission directly.)
The codebase consistently fails closed — refuters proved that three separately-reported "silent failure" claims all block rather than proceed. What's missing is the signal: a structured warn log on every non-ENOENT swallow, the auto-merge outcome surfaced instead of discarded, a watchdog rung for runs stuck in `accepted`, and pino `redact` as the transport backstop. _Principle: in an unattended system, an invisible safe failure is still an incident._ **Done when:** every `catch`-and-degrade path in `workflow-run/` and `cli/` emits a structured log (greppable check below), a stuck-`accepted` run produces an alert within one watchdog interval, and `logger.error({ secretsStore })` cannot print a token.

**Theme 2 — Finish the identity the spine already declared.** (H-1.)
Add `workflow_run_id` to the attempts schema and key new reads off it; converge `updateAttempt` toward event-sourced projection. This is PRD-sized, not audit-task-sized — it belongs in the roadmap pipeline (see Open Questions). _Principle: the durable layer must speak the product's core primitive._ **Done when:** `rg "workflow_run_id" src/persistence/sqlite/schema.ts` is non-empty, all new attempt rows carry it, and ADR-0001 §1/§4 status rows flip from ⚠ Drifted to Built.

**Theme 3 — Put walls inside `workflow-run/`.** (H-2, M-2, the madge cycle.)
Split into `intake/`, `engine/`, `archive/` subdirectories (or, cheaper first step: move the 4 intake files and 2 shared-type files, and split `slack-interactions.ts` along its two roles), then make the boundary mechanical so accretion can't silently resume. _Principle: the defect-gravity module gets boundaries first._ **Done when:** `pnpm run circular` passes, `executor.ts` imports nothing from intake files, and the boundary is enforced by a check that fails CI (madge or a lint rule), not by convention.

**Theme 4 — Wire the safety tools you already own.** (M-3, M-7, M-8, M-9, M-10, knip/madge, Low CI items.)
knip, madge, and the load tier all exist and none gates anything; the archive needs one hardening pass; the release pipeline needs a two-line fix or an honest removal. _Principle: a check that doesn't run is documentation, and stale documentation is worse than none — the repo's own rule._ **Done when:** `pnpm run knip && pnpm run circular` pass locally and run in the CI quality job, archive writes are atomic, and either `semantic-release` cuts a tag from CI or it's gone from package.json and AGENTS.md.

**Deliberately NOT fixing (effort vs payoff):**

- GitHub per-issue fetch N+1 (`issues-client.ts:228`) — REST has no batch endpoint; bounded by capped retries; revisit only if rate limits actually bite.
- DDL identifier interpolation (`database.ts:299`) — all callers hardcoded; a guard is cheap but the risk is hypothetical.
- Full Zod re-validation on every archive read — write-time validation covers it; only the two named residuals (M-3) are worth fixing.
- Executor retry-counter refactor (M-5) — genuinely hard, high regression risk, and the no-mock test suite around it is the mitigation; do it only when the next feature touches that loop anyway.
- Broad e2e expansion — add the 2–3 named scenarios (T-10), not a coverage campaign.

---

## 5. Task Plan

Each task is self-contained for a fresh Claude Code session. Acceptance criteria are runnable wherever possible. Efforts: S < 2h, M = half-day, L = 1–2 days, XL = needs breakdown.

**Quick wins (high impact, S effort): T-1, T-2, T-4, T-6, T-7.**

### M0 — Safety net

**T-1 — Fix the 6 dead-code findings and add knip + madge to the CI quality job.**
_Context:_ `pnpm run knip` and `pnpm run circular` both fail today and neither runs in CI. The knip findings are verified dead (see §3.7) with one false positive: `@aws-sdk/client-s3` is used by `scripts/*-r2.ts`, so add `scripts/**` to knip entry points rather than deleting the dep. The madge cycle is type-only: move `WorkflowRunIntakeExternalObject` and `WorkflowRunIntakeSource` out of `intake-core.ts` into `contracts.ts` (or a new shared types file) and update the two importers.
_Files:_ `src/persistence/sqlite/query-helpers.ts` (delete), `src/config/schemas/server.ts`, `src/config/schemas/index.ts`, `src/linear/nightly-failures.ts`, `src/linear/nightly-history.ts`, `src/http/request-schemas.ts`, `src/workflow-run/intake-core.ts`, `src/workflow-run/intake-idempotency-store.ts`, `src/workflow-run/contracts.ts`, knip config, `.github/workflows/ci.yml` (quality job).
_Acceptance:_ `pnpm run knip && pnpm run circular` exit 0; full gate passes; `rg -n "knip|circular" .github/workflows/ci.yml` shows both in the quality job.
_Effort:_ S–M | _Risk:_ Low (deletions are rg-verified unused; type moves are compile-checked) | _Deps:_ none.

**T-2 — Add an e2e test that proves an HTTP-API-created run gets driven.**
_Context:_ `POST /api/v1/workflow-runs` relies on `deps.eventBus?.emit(...)` (`src/http/routes/workflow-runs.ts:126`); the existing e2e (`tests/e2e/http-webhook.e2e.test.ts:193`) wires `eventBus` only for the webhook path, so a future regression dropping the constructor-level bus would strand HTTP runs silently and pass CI. Mirror the existing harness pattern (it already asserts archived artifacts and run status).
_Files:_ new `tests/e2e/http-run-create.e2e.test.ts` (or extend the existing file), `tests/e2e/` harness.
_Acceptance:_ `pnpm run test:e2e` passes and the new test asserts a POST-created run reaches `status: "done"` via the real bus; temporarily removing `eventBus` from the server construction makes it fail (verify once manually, like the harness's existing "bites" test).
_Effort:_ S | _Risk:_ Low | _Deps:_ none.

**T-3 — `withTempDir` test helper; migrate the worst offenders.**
_Context:_ 66 copies of the same mkdtemp/cleanup boilerplate (§3.3 M-7). Add one helper in `tests/helpers.ts` (repo style: plain function, no fixtures framework) and migrate the `tests/workflow-run/` files first; the rest can follow opportunistically.
_Acceptance:_ `rg -c "async function createTempDir" tests/ | wc -l` decreases from 66 to ≤ 50 with all of `tests/workflow-run/` migrated; `pnpm test` passes.
_Effort:_ M | _Risk:_ Low | _Deps:_ none.

### M1 — Correctness & visibility

**T-4 — Log every swallowed non-ENOENT error on the run-completion path, and surface the discarded auto-merge result.**
_Context:_ §3.2 M-4. Three verified sites fail closed but silently. Keep the fail-closed behavior; add structured warn logs distinguishing ENOENT (expected, keep silent or debug-level) from everything else, and consume the `AutoMergeCompletionResult` at `src/cli/run-start-command.ts:270` — log blocked status + reason, and include it in the handoff/notification path the file already uses.
_Files:_ `src/workflow-run/drive-accepted-run.ts` (`updatePublishResultUrl:496-500`, optionally a debug log in `reconfirmAndPersistVerification:447`), `src/cli/services.ts:283-285`, `src/cli/run-start-command.ts:270`.
_Acceptance:_ unit tests assert a warn log fires on a non-ENOENT read failure and that a blocked auto-merge produces an operator-visible record; `rg -n "catch \{$" src/workflow-run src/cli` shows no remaining bare catches on these paths; full gate passes.
_Effort:_ S | _Risk:_ Low | _Deps:_ none. _(Implementation sketch below.)_

**T-5 — Archive hardening: atomic metadata writes, guarded event parse, in-memory sequence counter.**
_Context:_ §3.2 M-3 / §3.4 M-9, all in `src/workflow-run/archive.ts`. Three changes: (1) metadata writes at `:124` and `:299` go through write-temp-then-`rename` (same dir, so rename is atomic on POSIX); (2) `readWorkflowRunEventsFromRunDir` (`:247`) wraps per-line parse in the same `WorkflowRunArchiveParseError` discipline as `:208-212`, and the sequence computation tolerates a truncated final line (drop it with a warn — it was never acknowledged); (3) cache the next sequence number per run dir inside the existing `withKeyedSerialChain` map so appends stop re-reading the whole log (the serial chain already guarantees single-writer per dir — the comment at `:171-173` documents exactly this invariant).
_Acceptance:_ new unit tests: a run dir with a truncated last JSONL line still appends and lists; a simulated partial metadata write (write temp file, don't rename) leaves the previous metadata readable; an append after 1,000 events does not re-read the log (assert via a spy on `readFile` or timing). `pnpm test` + `pnpm run test:integration` pass.
_Effort:_ M | _Risk:_ Medium (core persistence path — lean on the existing real-fs test suite) | _Deps:_ none. _(Implementation sketch below.)_

**T-6 — Make the run-create eventBus invariant mechanical.**
_Context:_ §3.1 M-1. Two options; do both, they're small: make `dep-validator.ts` fail hard (throw, not warn) when run-create routes are registered without `eventBus`; and add a watchdog/recovery rung that alerts on runs sitting in `accepted` beyond a threshold (the orchestrator currently has no awareness of them — `src/orchestrator/recovery.ts` is attempt-keyed only).
_Files:_ `src/http/dep-validator.ts`, `src/http/route-types.ts` (consider `eventBus` required on a narrowed run-create deps type), `src/orchestrator/recovery.ts` or `watchdog.ts`, `src/alerts/`.
_Acceptance:_ constructing the HTTP server with run-create routes and no eventBus throws at startup (unit test); a run stuck in `accepted` past the threshold produces an alert entry (integration test); full gate passes.
_Effort:_ M | _Risk:_ Low–Medium | _Deps:_ T-2 helps verify. _(Implementation sketch below.)_

**T-7 — Decide and fix the release pipeline.**
_Context:_ §3.5 M-10. Either (a) fix `.releaserc.yml` `branches: ["master"]` and add a CI release job (workflow*dispatch or on-push-to-master), or (b) remove semantic-release + the three plugins from package.json and correct AGENTS.md's claim. Requires Omer's call (Open Question 2).
\_Acceptance:* (a) a dry-run `npx semantic-release --dry-run` from CI logs a computed next version; or (b) `rg -l "semantic-release" package.json AGENTS.md docs/` returns nothing.
_Effort:_ S | _Risk:_ Low | _Deps:_ decision.

### M2 — High-leverage

**T-8 — Run-identity migration (PRD-sized — break down via the pipeline, don't execute from this brief).**
_Context:_ §3.1 H-1. Add `workflow_run_id` to `attempts` (nullable first, backfill, then NOT NULL), thread it through `AttemptStore` writes from the dispatch path (the dispatcher knows the run ID), key recovery and projections off it, and converge `updateAttempt` toward append+project. The afk-orchestrator umbrella may already own part of this — reconcile before creating issues.
_Acceptance (end-state):_ `rg "workflow_run_id" src/persistence/sqlite/schema.ts` non-empty; integration test creates a run, executes an attempt, and queries attempts by `workflow_run_id`; ADR-0001 §1 row flips to Built.
_Effort:_ XL | _Risk:_ High (durable schema + crash recovery) | _Deps:_ none technically; sequencing decision is Open Question 1.

**T-9 — Internal boundaries for `workflow-run/`.**
_Context:_ §3.1 H-2/M-2. Step 1 (cheap, mechanical): split `slack-interactions.ts` into an intake-side file and an engine-policy file; move shared types per T-1. Step 2: introduce `src/workflow-run/intake/`, `engine/`, `archive/` and move files with import updates — no logic changes, compiler-verified. Step 3: enforce — a madge/lint check that `engine/` does not import from `intake/`.
_Acceptance:_ full gate passes; `pnpm run circular` clean; the enforcement check fails CI when violated (demonstrate once); `git log --stat` shows moves only (no logic diffs).
_Effort:_ L | _Risk:_ Medium (wide import churn; do it in a quiet window, it conflicts with everything) | _Deps:_ T-1; coordinate with any in-flight branch.

**T-10 — Pagination + limits on archive-backed endpoints, then make the load tier honest.**
_Context:_ §3.4 M-9 + §3.3 M-8. Add `?limit=`/`?cursor=` (or at minimum a default cap + `since` filter) to the list and events routes, backed by capped reads in `archive.ts`; then rewrite `tests/http/load.test.ts` to hit the real archive-backed endpoints against a seeded archive (hundreds of runs), and wire `test:load` into CI (nightly is fine). If the tier isn't worth that, delete it — the repo's stale-docs rule applies to tests too.
_Acceptance:_ `curl /api/v1/workflow-runs` returns a bounded page with 500 seeded runs; load test asserts p99 against the real path; `rg "test:load" .github/workflows/` non-empty (or the tier is gone).
_Effort:_ M–L | _Risk:_ Low–Medium (HTTP contract change — internal API, version it casually) | _Deps:_ T-5 (sequence caching) pairs well.

### M3 — Quality & polish

**T-11 — pino `redact` backstop** (`src/core/logger.ts:29-41`): add paths for token/secret/key/authorization fields. _Acceptance:_ unit test logs an object containing a fake token and asserts `[Redacted]` in output. S, low risk.
**T-12 — Extract `pollUntilDurable` helper** for the duplicated loops at `intake-core.ts:251-290`, preserving the RIS-261/263 comments. _Acceptance:_ one implementation, both callers, `pnpm test` green. S.
**T-13 — Hygiene batch:** `safeParse` instead of the `as PrPublishMode` cast (`drive-accepted-run.ts:451`); pin `docs-ci.yml` actions to SHAs; warn-loudly (or fail) when pre-commit gitleaks binary is missing (`.husky/pre-commit`); seed `.gitleaks.toml` with an allowlist section; fix the two doc nits (`docs/testing-and-release.md:104` lint-staged scope, `docs/technical-spine.md:127` GitHub-adapter qualifier). _Acceptance:_ gate green; docs match `.lintstagedrc.json`. S.
**T-14 — Dispatch data-plane bind config** (`src/dispatch/entrypoint.ts:16`): `DISPATCH_BIND` env (default `0.0.0.0` for containers is fine, but make it overridable) and consider bearer-gating `/health` or reducing its payload. _Acceptance:_ unit test on bind resolution; manual `curl` check documented. S. Pairs with documenting remote dispatch mode (Open Question 5).
**T-15 — e2e scenario additions:** blocked-handoff path, duplicate external-object idempotency, budget exhaustion — one test each in the existing harness. _Acceptance:_ `pnpm run test:e2e` includes 3 new scenarios asserting archived artifacts. M.

### Implementation sketches (top 3)

**T-4 sketch.** In `updatePublishResultUrl` replace the bare catch:

```ts
} catch (error) {
  if (!isErrorCode(error, "ENOENT")) {
    logger.warn({ workflowRunId, error: toErrorString(error) }, "publish_result read failed; PR URL not stamped — auto-merge will block");
  }
  return;
}
```

(`isErrorCode` and `toErrorString` already exist in `src/utils/`; the file will need a logger parameter — `drive-accepted-run.ts` already threads one for other helpers.) Same shape in `services.ts:283`. At `run-start-command.ts:270`, capture the result: `const completion = await completeAutoMergeForRun(...)` and on `completion.status === "blocked"` log `{ workflowRunId, reason: completion.reason }` at warn and pass it to the existing notification/handoff path used for publish failures in the same file.

**T-5 sketch.** (1) Add `writeFileAtomic(path, data)` local to `archive.ts`: write `${path}.tmp-${randomUUID()}` then `rename` — use at `:124` and `:299`. (2) In `readWorkflowRunEventsFromRunDir`, wrap per-line `JSON.parse` in try/catch; on the _final_ line only, drop-with-warn (truncated append); otherwise throw `WorkflowRunArchiveParseError` like `:208-212`. (3) Module-level `const nextSequenceCache = new Map<string, number>()`; inside the existing `withKeyedSerialChain` callback, use `nextSequenceCache.get(artifactDir) ?? await nextWorkflowRunEventSequenceForRunDir(artifactDir)`, and set it to `firstSequence + events.length` after a successful append. The serial chain (comment at `:171-173`) already guarantees no concurrent writers per dir, so the cache can't race; it self-heals from the file on first touch after restart.

**T-6 sketch.** In `dep-validator.ts`, partition the dep list into `warnIfMissing` and `requiredForRoutes: { eventBus: ["POST /workflow-runs"] }`; throw an `Error` listing route + dep when a required one is absent (startup-time, so it converts the silent stall into a refused boot). For the sweep: in the orchestrator's existing tick or watchdog, call `archive.listWorkflowRuns()` filtered to `status === "accepted"` with `createdAt` older than `RISOLUTO_ACCEPTED_STALL_MS` (default ~5 min) and emit through the existing alert pipeline (`src/alerts/alert-pipeline.ts`). Note the list call is the M-9 hot path — fine at current scale, and T-10's capped reads keep it fine.

---

## 6. Open Questions (decisions only Omer can make)

1. **Run-identity migration sequencing (T-8).** This is the biggest item and it overlaps the afk-orchestrator umbrella (which owns the daemon build path). Should it become a roadmap row → PRD via the pipeline now, fold into afk-orchestrator, or wait until after the current umbrella ships? The audit's only claim is: its cost grows with every attempt-keyed feature added.
2. **Release automation (T-7): fix or remove?** Two-line fix (`branches: ["master"]` + a CI job) if you want tagged releases pre-1.0; otherwise remove the packages and the AGENTS.md claim. Which?
3. **Load tier (T-10): rewrite or delete?** It currently measures mocked handlers and never runs. Rewriting against seeded real archives is half a day; deleting is honest too.
4. **Vocabulary: "Engineering Intent."** CONTEXT.md says the code is wrong when names diverge, and the code says `WorkflowRunIntentArtifact`/`intent.v1` everywhere. Rename the code, or amend the glossary entry? (Mass renames were explicitly avoided in the terminology plan — amending the glossary may be the consistent move.)
5. **Is remote dispatch mode (`DISPATCH_MODE=remote`) real yet?** It's wired, undocumented, and binds `0.0.0.0`. If it's near-term, T-14 plus a docs section; if speculative, consider whether it should exist at all under the "stale doc is worse than no doc" rule applied to code surfaces.

---

_Audit artifacts: gate logs in `/tmp/risoluto-audit/` (this machine, this session). Refutation verdicts: 1 finding refuted, 4 downgraded, 2 Highs survived — details inline in §3._
