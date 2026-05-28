# Project Filetree

_Auto-maintained by `/filetree:update`. Each entry carries a content hash; mismatched hashes indicate stale summaries._

## (root)/

- `.dockerignore` — Docker build exclusion list; keeps build artifacts, dev config, tests, and docs out of the image context. <!--hash:ce855e61-->
- `.gitignore` — Git ignore rules; excludes build outputs, test coverage, secrets, editor noise, and the spine skill workspace. <!--hash:388b62ca-->
- `.gitleaks.toml` — Gitleaks config stub for Risoluto; referenced by pre-commit hook and CI secret scan step. <!--hash:8b7979ce-->
- `.gitmodules` — Git submodule registration; maps the research/ directory to the private risolutohq/risoluto-research repo. <!--hash:5c68ed07-->
- `.lintstagedrc.json` — lint-staged config; runs ESLint --fix and Prettier on staged TypeScript files, Prettier on JSON/YAML files. <!--hash:4e140f99-->
- `.prettierignore` — Prettier ignore list; excludes dist/, node_modules/, and coverage/ from formatting runs. <!--hash:2d0c0644-->
- `.prettierrc.json` — Prettier formatting config; 120-col, double quotes, 2-space indent, trailing commas, LF line endings. <!--hash:eac2feef-->
- `.releaserc.yml` — semantic-release config; drives automated changelog, package.json version bump, and GitHub release from Conventional Commits. <!--hash:35f90251-->
- `AGENTS.md` — Primary AI agent instruction file; defines project intent, working rules, verification gate, code-style ceilings, and living context index. <!--hash:f55c39ac-->
- `CHANGELOG.md` — Project changelog; records v0.1.0 foundation release scope and what was included or excluded from the clean baseline. <!--hash:fbdd3c5c-->
- `CLAUDE.md` — Claude Code entry point; single-line redirector that imports AGENTS.md as the canonical agent instruction source. <!--hash:ba336879-->
- `Dockerfile` — Main service Dockerfile; multi-stage build producing a Node 24 production image that runs the CLI entrypoint on port 4000. <!--hash:b82eaebe-->
- `Dockerfile.data-plane` — Data-plane Dockerfile; builds a Node 24 image for the dispatch entrypoint service running on port 9100. <!--hash:690ad75c-->
- `Dockerfile.sandbox` — Codex sandbox Dockerfile; Ubuntu 24.04 image with Node 22, bubblewrap, and the Codex CLI for isolated agent execution. <!--hash:489346c5-->
- `LICENSE` — MIT license for the Risoluto project, copyright Omer Faruk Oruc 2026. <!--hash:db1c2f96-->
- `README.md` — Project README; describes Risoluto's purpose, current shape (CLI-first, Workflow Run primitive), and development setup commands. <!--hash:c15117e2-->
- `commitlint.config.ts` — commitlint config; extends conventional-commits and enforces a fixed allowlist of commit scopes for this repo. <!--hash:52f11662-->
- `docker-compose.yml` — Docker Compose spec; defines risoluto service, optional Cloudflare tunnel, and optional data-plane service with shared volumes and env wiring. <!--hash:49819d2b-->
- `eslint.config.js` — ESLint config enforcing naming, complexity, file/function length, dead-code, and tech-debt rules for src/ and tests/. <!--hash:4605591a-->
- `knip.config.ts` — Knip unused-export finder config; scopes analysis to src/ TypeScript files. <!--hash:305987d5-->
- `knip.json` — Knip dead-code config: entry points, project globs, and barrel index files exempted from export analysis. <!--hash:c0e37760-->
- `package.json` — Root package manifest: scripts (build/test/lint/typecheck), runtime and dev dependencies, and bin entry point. <!--hash:cc0bbe7d-->
- `pnpm-workspace.yaml` — pnpm workspace config; singles out better-sqlite3 and esbuild as the only native-build dependencies. <!--hash:b5a8fc39-->
- `quarantine.json` — Flaky-test quarantine registry; currently empty (no tests quarantined). <!--hash:fe51488c-->
- `stryker.config.json` — Stryker mutation testing config: vitest runner, TypeScript checker, thresholds, and incremental mode. <!--hash:633c3bf2-->
- `tsconfig.eslint.json` — TypeScript config for ESLint; extends compilation to src, tests, scripts, and config files with noEmit so ESLint can type-check without emitting output. <!--hash:78339653-->
- `tsconfig.json` — Root TypeScript compiler config for build output; compiles src to dist with declarations, source maps, and NodeNext module resolution. <!--hash:70d351e6-->
- `tsconfig.typecheck.json` — TypeScript config for full type-check pass; includes src, scripts, and tests (excluding e2e) with noEmit and vitest types. <!--hash:fb5d50fb-->
- `typedoc.json` — TypeDoc config for generating the Risoluto API reference from src/ into docs/api/. <!--hash:d092178c-->
- `vitest.config.ts` — Default unit test suite config; runs all non-integration tests with v8 coverage thresholds and a quarantine setup file. <!--hash:27d06e9e-->
- `vitest.integration.config.ts` — Integration test suite config; targets \*.integration.test.ts files, excludes live tests, and retries flaky runs up to twice. <!--hash:ae6377cf-->
- `vitest.live.config.ts` — Live integration test suite config; runs tests against real external APIs in tests/integration/live/ with a 30-second timeout. <!--hash:fb6be9c1-->
- `vitest.load.config.ts` — Load/performance test suite config; targets the HTTP load test file with a 30-second timeout. <!--hash:c2959d3a-->

## .claude/

- `settings.json` — Claude Code project settings; configures PostToolUse Prettier auto-format and Stop hook for TS lint reminders. <!--hash:2e895358-->

## .claude/hooks/

- `stop-ts-check.sh` — Claude Code Stop hook; runs ESLint on uncommitted TypeScript files and emits a typecheck reminder. <!--hash:57df8651-->

## .claude/skills/init-research/

- `SKILL.md` — Skill definition for /init-research; verifies and initializes the private research/ git submodule. <!--hash:1f84c5c5-->

## .claude/skills/v1-check/

- `SKILL.md` — Skill definition for /v1-check; runs the five-step pre-PR gate (build → lint → format → test → typecheck) in order. <!--hash:c895ff9c-->

## .github/

- `CODEOWNERS` — GitHub CODEOWNERS file; assigns OmerFarukOruc as required reviewer for all paths including src/, docs/, and .github/. <!--hash:7452d510-->
- `dependabot.yml` — Dependabot config; schedules weekly npm and GitHub Actions dependency updates grouped by dev vs production. <!--hash:fea8aaed-->
- `pull_request_template.md` — GitHub PR template; prompts for description, change type, testing evidence, and a pre-merge checklist. <!--hash:2a91971e-->

## .github/ISSUE_TEMPLATE/

- `bug_report.yml` — GitHub issue template for bug reports; collects description, reproduction steps, expected/actual behavior, and environment. <!--hash:6627e177-->
- `feature_request.yml` — GitHub issue template for feature requests; collects problem statement, proposed solution, and alternatives considered. <!--hash:53bae01b-->

## .github/workflows/

- `ci.yml` — Main CI workflow; runs build, quality, unit tests (Node 22/24), integration, live smoke, Docker build, Gitleaks, and dependency review. <!--hash:75fa0d06-->

## .husky/

- `commit-msg` — Husky commit-msg hook; enforces Conventional Commit format via commitlint before every commit. <!--hash:d7e53283-->
- `post-merge` — Husky post-merge hook; runs Prettier on TypeScript and script files to fix formatting drift introduced by GitHub merges. <!--hash:9d8ab9a0-->
- `pre-commit` — Husky pre-commit hook; scans staged files for secrets with Gitleaks then runs lint-staged for ESLint and Prettier. <!--hash:afd3ec8c-->
- `pre-push` — Husky pre-push hook; runs build, tests, and typecheck before pushing; supports SKIP_HOOKS and FULL_CHECK escape hatches. <!--hash:c110a2e2-->

## .superset/

- `config.json` — Superset (Codex sandbox) config; defines setup commands to enable Corepack, copy live env, and install deps, plus dev run command. <!--hash:e76801d1-->

## bin/

- `build-sandbox.sh` — Shell script that builds the risoluto-codex:latest Docker sandbox image from Dockerfile.sandbox. <!--hash:5f38fab2-->
- `risoluto` — CLI launcher script; resolves the package root and delegates to the compiled dist/cli/index.js entry point. <!--hash:740c9100-->

## docs/

- `capability-backlog.md` — Living post-foundation work ledger; tracks capabilities by status from idea through shipped or dropped. <!--hash:22b0a19d-->
- `decisions.md` — Chronological register of all accepted Risoluto decisions; links to ADRs for hard-to-reverse ones. <!--hash:281f732a-->
- `product-spine.md` — Canonical product identity, glossary, architecture principles, and v1 scope boundaries for Risoluto. <!--hash:13a37144-->
- `release-rules.md` — Versioning model, CI band requirements, and 1.0.0 Foundation Baseline qualification checklist. <!--hash:d42d0f12-->
- `research-to-shipping-pipeline.md` — The planning pipeline: stage-by-stage how-to, frontmatter contracts, ownership rules, and troubleshooting — the single operational reference (decisions in ADR-0007). <!--hash:e62f7c44-->
- `technical-spine.md` — Maximal v1 technical surface map: all layers, adapter contracts, boundary rules, and what v1 does not ship. <!--hash:908555d5-->
- `test-capability-matrix.md` — Migration ledger tracking replacement of legacy tests with v1 behavior-first public-interface coverage per capability. <!--hash:7390e477-->
- `testing-strategy.md` — Defines unit, integration, and live test tiers; model profiles; and what v1 requires for 1.0.0. <!--hash:c7e04ff4-->

## docs/adr/

- `0001-workflow-run-as-core-primitive.md` — ADR-0001; records the decision to use Workflow Run (not Issue) as the core primitive and explains tracker-as-adapter rationale. <!--hash:efd1e533-->
- `0002-state-machine-with-graph-inside-states.md` — ADR: outer state machine + intra-state role DAG design; rejects pure state machine and pure DAG alternatives. <!--hash:b2e44567-->
- `0003-typed-artifact-contracts.md` — ADR: typed, versioned artifact contracts between role executions; validated at production time, not consumption. <!--hash:2f075f82-->
- `0004-event-sourced-run-log-with-policy.md` — ADR: append-only event-sourced run log as single source of truth for replay, audit, and export. <!--hash:2b3a759a-->
- `0005-built-in-typescript-workflow-definitions-before-dsl.md` — ADR: ship built-in TypeScript workflow definitions first; defer user-authored DSL until 3+ definitions exist. <!--hash:721f3905-->
- `0006-environment-portable-control-and-execution-plane.md` — ADR: separate control plane from execution plane with a network-shaped contract from v1 onward. <!--hash:e48ef8fa-->

## scripts/

- `backend-integration-coverage.mjs` — Runs deterministic and optionally live integration suites, merges coverage maps, and enforces per-metric thresholds. <!--hash:81c98294-->
- `live-preflight.ts` — CLI entrypoint for the live preflight check; delegates to src/live/preflight-cli and forwards exit code. <!--hash:daa3d27b-->
- `mutate-changed.mjs` — Runs Stryker mutation testing scoped to only src/ files changed vs HEAD, skipping type-only and entrypoint exclusions. <!--hash:fe815034-->
- `nightly-evidence-links.ts` — Generates a JSON file of GitHub Actions artifact URLs (HTML report, trace, video) for the nightly run. <!--hash:011a7c63-->
- `nightly-failure-summary.ts` — Aggregates nightly job statuses and Vitest JSON reports into a single failure-summary JSON for Linear intake. <!--hash:80704c82-->
- `nightly-history-r2.ts` — Downloads or uploads the nightly Linear issue history file from/to a Cloudflare R2 bucket. <!--hash:4240c094-->
- `nightly-linear-intake.ts` — Creates or updates a Linear nightly failure issue from the nightly summary; supports dry-run and live modes. <!--hash:5186fe50-->
- `nightly-validation-fail.ts` — Intentionally fails a named nightly CI job on workflow_dispatch for pipeline validation testing. <!--hash:5fcf1be6-->
- `post-merge-prd.mjs` — Post-merge PRD automation; back-comments from:prd-<slug> Linear issues with the merged PR then flips the PRD frontmatter status to shipped (flip is last). <!--hash:30e4d644-->
- `prd-drift-check.ts` — Pre-push/CI gate; compares each docs/prds/<slug>.md body (first 255 chars) against its Linear project description and exits non-zero on drift. <!--hash:29cf44cc-->
- `prd-linear.ts` — Linear GraphQL helpers for the PRD pipeline; API-key hard gate, project fetch, and extractSlugId URL parsing shared by drift-check and reconcile. <!--hash:27a4913e-->
- `prd-reconcile.ts` — Adopts a Linear-side PRD edit back into git; writes the Linear description into docs/prds/<slug>.md on branch pipeline/<slug>-prd-reconcile. <!--hash:7f0b645f-->
- `quarantine-heal.ts` — Reads Vitest JSON results and updates quarantine.json: increments pass counts, auto-heals at threshold, removes stale entries. <!--hash:308c9c5d-->
- `quarantine-shared.ts` — Shared quarantine types, constants (MAX_QUARANTINED, HEAL_THRESHOLD), path, and loadEntries utility used by quarantine scripts. <!--hash:ab92fe6d-->
- `quarantine.ts` — CLI for managing the flaky-test quarantine registry: add, remove, and list quarantined tests with cap enforcement. <!--hash:5315b5e5-->
- `sync-labels.sh` — Idempotently creates or updates GitHub issue labels (priority, type, area, workflow) on risolutohq/risoluto. <!--hash:fde247a5-->
- `upload-nightly-artifacts-r2.ts` — Uploads nightly CI artifacts (files or directories) to Cloudflare R2 and writes a manifest JSON with public URLs. <!--hash:1f990fa2-->
- `validate-research.ts` — Validates research/ corpus frontmatter (targets, ideas) against research/.schemas/\*.json; the pnpm validate:research gate. <!--hash:d9f30228-->

## scripts/.pipeline/

- `config.yml` — Autonomous pipeline definitions (audit-and-fix, full-lifecycle, review-only, investigate, plan-and-implement) with budget and phase config. <!--hash:6ab37525-->

## scripts/.pipeline/runs/audit-and-fix/20260408-152855/

- `summary.json` — Saved outcome record for a successful audit-and-fix pipeline run on 2026-04-08. <!--hash:b89c2291-->

## scripts/.pipeline/runs/full-lifecycle/20260408-152905/

- `summary.json` — Saved outcome record for a successful full-lifecycle pipeline run on 2026-04-08. <!--hash:2fa77f31-->

## scripts/.pipeline/runs/review-only/20260408-152905/

- `summary.json` — Saved outcome record for a successful review-only pipeline run on 2026-04-08. <!--hash:e686e323-->

## skills/risoluto-features/

- `SKILL.md` — Skill definition for the risoluto-features spine updater: two-repo model, 12-step pipeline, map-reduce architecture. <!--hash:09663808-->

## skills/risoluto-features/assets/

- `viewer-template.html` — Single-file Tailwind HTML viewer for RISOLUTO_FEATURES.json; hydrated client-side with search, filters, citations, and diff banner. <!--hash:ce7a0b69-->

## skills/risoluto-features/references/

- `bundle-rules.md` — Defines the 11 feature bundles, what belongs in each, and a decision tree for resolving ambiguous assignments. <!--hash:0f470246-->
- `cold-start.md` — Procedure for building the feature spine from scratch when no prior RISOLUTO_FEATURES.md exists. <!--hash:94e4a0a5-->
- `diff-section.md` — Template and rules for the 'Changed since last spine' markdown section; generated by diff_spines.py, not hand-written. <!--hash:66250992-->
- `feature-entry-template.md` — Canonical markdown and JSON shape for a single feature entry in the spine, with non-negotiable style rules. <!--hash:be30a488-->
- `json-schema.md` — Authoritative JSON schema for RISOLUTO_FEATURES.json, covering every top-level field and validation rules. <!--hash:4c13edfc-->
- `subagent-prompts.md` — Filled-in prompt templates for extract and verify subagents used in the risoluto-features map-reduce pipeline. <!--hash:c32f3935-->
- `verification-checklist.md` — Six-step checklist run on every existing spine entry to detect symbol drift, constant changes, and removals. <!--hash:6aa21704-->

## skills/risoluto-features/scripts/

- `diff_spines.py` — Computes added/modified/removed diff between two RISOLUTO_FEATURES.json payloads; outputs markdown or JSON. <!--hash:83c94474-->
- `fact_check.py` — Verifies quoted constants in observable_behaviors exist in cited source line ranges; exits 1 on hard failures. <!--hash:c0980346-->
- `lint_md.py` — Lints RISOLUTO_FEATURES.md for duplicate H3s, unsubstituted template tokens, and malformed Evidence blocks. <!--hash:d875b63f-->
- `render_html.py` — Hydrates viewer-template.html with the JSON sidecar payload, writing a self-contained feature viewer HTML file. <!--hash:7e30da52-->
- `render_meta.py` — Generates the Summary table and Coverage manifest markdown sections from the RISOLUTO_FEATURES.json payload. <!--hash:7521b7a7-->
- `validate_json.py` — Validates RISOLUTO_FEATURES.json against schema rules: unique IDs, valid bundles, citation counts, and line ranges. <!--hash:a2f9c56c-->

## skills/risoluto-grill/

- `SKILL.md` — Grill skill: stress-tests a research idea until 'Why us / why now' and 'Smallest shippable shape' crystallise in the idea README (Phase 3.1). <!--hash:338b97b7-->

## skills/risoluto-grill/scripts/

- `grill-write.mjs` — Grill writer; rewrites the two operator-owned idea sections (and optional status flip), preserving frontmatter and the synthesizer-owned block. <!--hash:05b215e4-->
- `preload.mjs` — Grill preloader; bundles the idea README, cited target READMEs, backlog row, and feature mentions as JSON context. <!--hash:6da2a06a-->

## skills/risoluto-researcher/

- `SKILL.md` — Researcher skill: captures an external URL (+paste) into research/targets/<slug>/ as target README + source file and regenerates INDEX.md (Phase 1.3). <!--hash:f0d0c33d-->

## skills/risoluto-researcher/scripts/

- `research.mjs` — Researcher write script; builds target/source markdown with pipeline-valid frontmatter (deep gh capture for repos) and regenerates research/INDEX.md. <!--hash:07308f14-->

## skills/risoluto-synthesizer/

- `SKILL.md` — Synthesizer skill: clusters research targets into idea READMEs by shared ideas: tag and rewrites the idea-status rows of capability-backlog.md (Phase 2.1). <!--hash:1b64a423-->

## skills/risoluto-synthesizer/scripts/

- `synthesize.mjs` — Synthesizer engine; merges target/source ideas: tags into research/ideas/<slug>/ clusters and the synthesizer-owned backlog row block (idempotent). <!--hash:237c8340-->

## skills/risoluto-tdd/

- `SKILL.md` — TDD skill: Linear-aware red-green-refactor for a ticket ref; validates blocked-by, back-comments the PR, applies from:prd-<slug> label (Phase 4.2). <!--hash:aa22bfa2-->
- `deep-modules.md` — TDD reference: designing deep modules — simple interface over substantial implementation. <!--hash:0d9720cf-->
- `interface-design.md` — TDD reference: interface-design principles applied during the red-green-refactor loop. <!--hash:a0a20ca4-->
- `mocking.md` — TDD reference: when to mock versus use real collaborators in tests. <!--hash:71cbfee6-->
- `refactoring.md` — TDD reference: refactoring guidance for the refactor step of the loop. <!--hash:8a444392-->
- `tests.md` — TDD reference: how to write behavior-focused, integration-first tests. <!--hash:ff22f809-->

## skills/risoluto-to-issues/

- `SKILL.md` — to-issues skill: breaks docs/prds/<slug>.md into flat Linear issues labelled from:prd-<slug> with LLM-inferred blocked-by (Linear MCP only, Phase 4.1). <!--hash:394f4d70-->

## skills/risoluto-to-issues/scripts/

- `preload.mjs` — to-issues preloader; emits the PRD body, slug, linear_project, and backlog category as JSON for issue breakdown. <!--hash:5b87cf02-->

## skills/risoluto-to-prd/

- `SKILL.md` — to-prd skill: promotes a grilled idea into docs/prds/<slug>.md + a mirrored Linear project + pipeline/<slug>-prd branch; idempotent create/sync (Phase 3.2). <!--hash:b7cd2b65-->

## skills/risoluto-to-prd/scripts/

- `preload.mjs` — to-prd preloader; reports create-vs-sync mode, why-us/smallest-shape fill state, and PRD existence as JSON. <!--hash:8858f4a1-->
- `write.mjs` — to-prd write script; renders the PRD from the idea README and syncs the Linear project description (create or overwrite), updating idea frontmatter. <!--hash:b1f94ad8-->

## skills/risoluto-vault/

- `SKILL.md` — Vault skill: configures research/ as a scoped Obsidian vault (.obsidian config, templates, Dataview views); idempotent drift repair (Phase 1.2). <!--hash:724f5090-->

## skills/risoluto-vault/assets/dataview/

- `ideas-thin-evidence.md` — Vault asset: Dataview note listing ideas with fewer than two evidence targets. <!--hash:d4b82585-->
- `targets-stale.md` — Vault asset: Dataview note listing targets not updated in 90+ days. <!--hash:10c47489-->
- `untagged-sources.md` — Vault asset: Dataview note listing source files with no ideas: tag. <!--hash:28b28a05-->

## skills/risoluto-vault/assets/obsidian-config/

- `app.json` — Vault asset: canonical Obsidian app.json (relative markdown links) deployed by apply.mjs. <!--hash:fc013921-->
- `appearance.json` — Vault asset: canonical Obsidian appearance.json deployed by apply.mjs. <!--hash:e6bfdd50-->
- `community-plugins.json` — Vault asset: canonical Obsidian community-plugins list (Web Clipper, Dataview, Templater) deployed by apply.mjs. <!--hash:2b37da71-->
- `core-plugins.json` — Vault asset: canonical Obsidian core-plugins config deployed by apply.mjs. <!--hash:7910e04c-->

## skills/risoluto-vault/assets/templates/

- `idea-readme.md` — Vault asset: pipeline template for an idea README. <!--hash:8829cc83-->
- `source.md` — Vault asset: pipeline template for a research source file. <!--hash:598f088a-->
- `target-readme.md` — Vault asset: pipeline template for a target README. <!--hash:112366d1-->

## skills/risoluto-vault/scripts/

- `apply.mjs` — Vault apply script; deploys/repairs .obsidian config, templates, and Dataview notes into research/ (WRITE/REPAIR/KEEP per file; --dry-run/--force). <!--hash:94c1734a-->

## src/agent/

- `codex-request-handler.ts` — Handles incoming JSON-RPC requests from Codex: approvals, tool calls, permissions, and fatal protocol errors. <!--hash:463eb1b6-->
- `json-rpc-connection.ts` — Manages bidirectional JSON-RPC over a child process stdio: sends requests with timeouts, dispatches notifications. <!--hash:f45eaa54-->

## src/agent-runner/

- `abort-outcomes.ts` — Maps abort signal reasons and runtime errors to typed RunOutcome values for cancelled, timed-out, and failed runs. <!--hash:8201a3ef-->
- `attempt-executor.ts` — Launches a single agent attempt: prepares workspace, starts session, runs turns, invokes self-review, and cleans up. <!--hash:c2c88914-->
- `contracts.ts` — Defines the AgentRunnerEventHandler callback type used to stream run events with usage and stop-signal metadata. <!--hash:e6283242-->
- `docker-runtime.ts` — AgentSessionPort implementation that creates Docker-backed Codex sessions and delegates turn execution to DockerSession. <!--hash:eb87cc4f-->
- `docker-session.ts` — Spawns the Docker container, wires the JSON-RPC connection, polls container stats, and handles cleanup on shutdown. <!--hash:9b94eaa0-->
- `error-classifier.ts` — Extracts typed Codex error info (type, message, retryAfterMs) from JSON-RPC error response payloads. <!--hash:08cd6740-->
- `exit-classifier.ts` — Classifies container exit state into RunOutcome, detecting OOM-kill via docker inspect on exit code 137. <!--hash:87110957-->
- `helpers.ts` — Extracts and normalizes fields (threadId, turnId, token usage, sandbox policy, item content) from JSON-RPC payloads. <!--hash:287d4ed9-->
- `index.ts` — AgentRunner entry point; wires DockerCodexRuntimePort and DefaultAttemptExecutor and exposes runAttempt. <!--hash:12e4b89a-->
- `model-validation.ts` — Fetches the available model list from Codex via model/list to warn when the configured model is not present. <!--hash:6f975a95-->
- `notification-handler.ts` — Translates Codex JSON-RPC notifications into RecentEvents, with debounced streaming buffers for live deltas. <!--hash:61bd981a-->
- `preflight.ts` — Runs configured preflight shell commands inside the sandbox before the main turn and reports pass/fail. <!--hash:f450c69f-->
- `self-review.ts` — Triggers a Codex self-review on uncommitted changes after a successful run and returns a pass/fail summary. <!--hash:29340df8-->
- `session-helpers.ts` — Waits for container stdout readiness with stderr capture, and builds the dynamic tool schema list for thread/start. <!--hash:1f065e47-->
- `session-init.ts` — Initializes a Codex session: waits for startup, authenticates, starts or resumes the thread, renders the prompt template. <!--hash:5842a576-->
- `session-port.ts` — Port and input/output types for AgentSession lifecycle: start, initialize, execute, review, steer, and shutdown. <!--hash:41e5cf29-->
- `thread-compact.ts` — Requests Codex thread/compact/start to reduce context when the context window is exceeded; returns success/failure. <!--hash:788de964-->
- `turn-executor-types.ts` — Types for turn execution: TurnResult discriminated union and input/state interfaces used by turn-executor. <!--hash:8d26e6e9-->
- `turn-executor.ts` — Drives the turn loop: sends prompts, waits for completion, detects stop signals, handles context compaction and abort. <!--hash:bf8224de-->
- `turn-state.ts` — Mutable per-session state: streaming buffers for deltas, turn-completion resolvers, reasoning accumulators, and review summaries. <!--hash:a7c9f676-->

## src/alerts/

- `alert-pipeline.ts` — Matches events against alert rules, enforces per-rule cooldowns, and delivers notifications via NotificationManager. <!--hash:2f8bdf65-->
- `engine.ts` — Subscribes to the TypedEventBus and feeds every non-notification event into AlertPipeline for rule evaluation. <!--hash:f83e2b88-->
- `history-store.ts` — Port interface and record types for persisting and querying alert delivery history. <!--hash:59d0b84a-->

## src/audit/

- `logger.ts` — Records config, secret, and template mutations to the config_history table; redacts secret values on write. <!--hash:ad0c3e6d-->
- `port.ts` — AuditLoggerPort interface for logging and querying config/secret/template mutations without depending on SQLite. <!--hash:48b84476-->
- `types.ts` — Shared type definitions for the audit subsystem; AuditEntry, AuditRecord, and AuditQueryOptions interfaces used by audit port and logger. <!--hash:7c4cebae-->

## src/automation/

- `port.ts` — Port interface for the automation store; defines create/finish/list run operations and their input/output types. <!--hash:a47eebc2-->
- `runner.ts` — Executes a single automation run in report, findings, or implement mode; persists the result and emits lifecycle events. <!--hash:77e23962-->
- `scheduler.ts` — Manages cron-scheduled automations; syncs from config, starts/stops node-cron tasks, and exposes manual trigger. <!--hash:baf5abc1-->
- `types.ts` — Shared domain types for automation runs: trigger, status, and AutomationRunRecord. <!--hash:31cba93a-->

## src/cli/

- `index.ts` — CLI entry point; bootstraps config stores, services, HTTP server, and manages startup/shutdown signal handling. <!--hash:a84b542c-->
- `notifications.ts` — Wires notification channels from config into the NotificationManager; re-wires on config changes and warns on port drift. <!--hash:c788589f-->
- `parse-args.ts` — Parses CLI flags (--port, --data-dir), resolves data/archive dirs, and initializes the logger and error tracker. <!--hash:17a984af-->
- `runtime-providers.ts` — Factory functions that build runtime GitManager and RepoRouter providers wired to the live service config. <!--hash:f5acf6bb-->
- `services.ts` — Assembles all Risoluto subsystems in dependency order across 7 phases and returns the fully wired service graph. <!--hash:247312f7-->
- `workflow-run-attempt-command.ts` — CLI subcommands for workflow run attempts: start, complete, fail, cancel, and list attempts. <!--hash:a91f483d-->
- `workflow-run-command.ts` — Top-level dispatcher for all workflow-run CLI subcommands; routes to the appropriate handler based on argv. <!--hash:e39a62e6-->
- `workflow-run-list-command.ts` — CLI subcommand to list workflow runs from the data directory, with optional JSON output. <!--hash:4f34e365-->
- `workflow-run-worker-process-command.ts` — CLI subcommand to record a worker process event (role, harness, status, exit code) for a workflow run. <!--hash:078f747d-->
- `workflow-run-workspace-command.ts` — CLI subcommands to record workspace lifecycle and cleanup events for a workflow run. <!--hash:940111e3-->

## src/codex/

- `admin-service.ts` — Facade over the Codex control plane; exposes read and mutation methods for account, threads, MCP servers, and user input. <!--hash:4f817a85-->
- `admin-snapshot.ts` — Reads a full Codex admin snapshot in parallel (account, models, threads, features, MCP) and returns a typed aggregate. <!--hash:7cca6e2d-->
- `auth-file.ts` — Reads, normalizes, and builds Codex auth.json records; extracts PKCE tokens from various legacy shapes. <!--hash:6ca72bb7-->
- `control-plane.ts` — Manages the Codex app-server process over JSON-RPC; handles connection lifecycle, capability probing, and user-input requests. <!--hash:d1c6cea6-->
- `methods.ts` — Typed constants for all Codex app-server JSON-RPC method names to prevent typos across call sites. <!--hash:f914c432-->
- `model-catalog.ts` — Reads the Codex model list via the control plane; falls back to spawning codex directly or the static pricing table. <!--hash:d162dcd3-->
- `model-list.ts` — Fetches available Codex models by spawning codex app-server and querying model/list via JSON-RPC; caches results for 5 minutes. <!--hash:a3116bc3-->
- `protocol.ts` — JSON-RPC 2.0 message constructors, type guards, and an isolated per-session ID counter. <!--hash:91bc06a8-->
- `runtime-config.ts` — Builds codex config.toml and base64 auth.json for worker dispatch; handles provider selection and token refresh. <!--hash:7de4c336-->
- `token-refresh.ts` — Detects expired OpenAI PKCE tokens via JWT exp or the expired field, then refreshes via the OpenAI token endpoint. <!--hash:4159233e-->

## src/config/

- `coercion.ts` — Primitive coercion helpers (asRecord, asString, asNumber, asBoolean, etc.) for safe config normalization from unknown input. <!--hash:86cf518d-->
- `db-store.ts` — SQLite-backed config overlay store; implements ConfigOverlayPort with atomic section upserts and change notifications. <!--hash:48337daa-->
- `defaults.ts` — Canonical default values for each config section and the default prompt template, seeded on first boot. <!--hash:8ad11a20-->
- `derivation-pipeline.ts` — Orchestrates the full config derivation pipeline: reads merged config sections and delegates to per-domain builders and normalizers. <!--hash:1c5f43b4-->
- `index.ts` — Barrel re-export for the public config API: deriveServiceConfig, ConfigOverlayStore, ConfigOverlayPort, ConfigStore. <!--hash:44dfe0fd-->
- `live-preflight-config.ts` — Loads and validates live test environment config from .env file; checks required keys and resolves GitHub app auth strategy. <!--hash:807b1ade-->
- `merge.ts` — Deep merge utility for config objects; arrays replace, objects recurse, primitives overwrite. <!--hash:35b0b1c8-->
- `normalizers.ts` — Per-domain config normalizers for notifications, triggers, automations, alerts, GitHub, repos, state machine, and codex providers. <!--hash:0e78cf25-->
- `overlay-helpers.ts` — Low-level overlay map utilities: stable stringify, deep merge, path-based set/delete, and dangerous-key guards. <!--hash:60081760-->
- `overlay.ts` — File-backed YAML config overlay store; watches the overlay file for changes and serializes mutations atomically. <!--hash:0a8c4a43-->
- `resolvers.ts` — Resolves config string values through env var, $SECRET, home path, and $TMPDIR expansion chains. <!--hash:cb258222-->
- `section-builders.ts` — Derives typed ServiceConfig subsections (tracker, workspace, agent, codex, webhook, polling, server) from raw config records. <!--hash:86b12098-->
- `store.ts` — Holds the live ServiceConfig, reloads it on overlay or secrets changes, and notifies subscribers. <!--hash:8e153a4c-->
- `test-model-profiles.ts` — Defines named model profiles (pr-live-smoke, release-live, regression-frozen) used by live and integration test tiers. <!--hash:e0a43fe9-->
- `url-policy.ts` — Enforces HTTPS allowlist policy for tracker, GitHub API, Slack webhook, and notification webhook URLs. <!--hash:b2536bfd-->
- `validators.ts` — Validates dispatch-critical config fields (tracker, Codex auth, provider, API key env) and collects self-routing repo warnings. <!--hash:bb9c5feb-->

## src/config/schemas/

- `agent.ts` — Zod schema for the agent config subsection; defines concurrency, retry, PR monitor, auto-claim, and auto-merge fields. <!--hash:742eb203-->
- `codex.ts` — Zod schemas for the codex subsection: auth, sandbox, provider, approval policy, and reasoning effort. <!--hash:da6c5318-->
- `index.ts` — Barrel re-export for all Zod config schemas across tracker, webhook, workspace, agent, codex, and server subsections. <!--hash:8d9b95cd-->
- `pr-policy.ts` — Zod schema for PR auto-merge policy; controls enabled flag, allowed paths, diff size limits, labels, and merge method. <!--hash:10bb5b85-->
- `server.ts` — Zod schemas for server port, polling interval, notification channels, GitHub, repo, and state machine config subsections. <!--hash:3c246ecc-->
- `tracker.ts` — Zod schema for the tracker config subsection (kind, API key, endpoint, active/terminal states). <!--hash:1c4079d6-->
- `webhook.ts` — Zod schema for the webhook config subsection; validates HTTPS URL and polling/health-check intervals. <!--hash:1143efa9-->
- `workspace.ts` — Zod schema for the workspace config subsection: root path, lifecycle hooks, strategy, and branch prefix. <!--hash:f7aa9aa3-->

## src/core/

- `attempt-analytics.ts` — Utility functions to sort attempts newest-first and sum elapsed duration across completed attempt records. <!--hash:75d11684-->
- `attempt-store-port.ts` — Port interfaces for attempt storage: full CRUD, PR upsert/query, aggregate analytics, and checkpoint persistence. <!--hash:c98b876a-->
- `content-sanitizer.ts` — Redacts secrets (bearer tokens, API keys, credentials) from strings and objects before logging or storage. <!--hash:ba28e93c-->
- `cost-sample-port.ts` — Port interface for appending and querying time-series cost/token samples with 7-day retention. <!--hash:0a4a18e6-->
- `error-tracking.ts` — Initializes a logger-backed error tracker (or no-op) driven by SENTRY_DSN; exposes captureException and breadcrumb APIs. <!--hash:2e681770-->
- `event-bus.ts` — Generic typed publish-subscribe event bus with per-channel and wildcard subscriptions. <!--hash:fb4005e7-->
- `issue-config-port.ts` — Port interface for reading and writing per-issue model and template overrides in the issue_config table. <!--hash:29ca0ed7-->
- `lifecycle-events.ts` — Factory function for RecentEvent records used to log workflow-run lifecycle transitions. <!--hash:5e7db37e-->
- `logger.ts` — Creates a Pino-backed RisolutoLogger with JSON or logfmt output format controlled by RISOLUTO_LOG_FORMAT. <!--hash:b2f19946-->
- `model-pricing.ts` — Static USD-per-1M-token price table and cost computation helpers for OpenAI and Anthropic models. <!--hash:2e81a94a-->
- `notification-types.ts` — Type definitions for notification channels, delivery summaries, trigger config, automation config, and alert rules. <!--hash:8965ff91-->
- `risoluto-events.ts` — Typed event map for the orchestrator event bus; defines payload shapes for every domain channel. <!--hash:40dcd32e-->
- `signal-detection.ts` — Detects done/blocked stop signals in agent output via text markers or structured JSON status fields. <!--hash:83889a27-->
- `types.ts` — Top-level type barrel; re-exports all domain types from sub-modules plus WorkflowDefinition and ValidationError. <!--hash:a5d5f33c-->

## src/core/types/

- `attempt.ts` — Domain types for attempt records, run outcomes, retry entries, recent events, and checkpoint records. <!--hash:9f3d9785-->
- `codex.ts` — Domain types for Codex agent configuration: auth, provider, sandbox resources/security/logs, and top-level CodexConfig. <!--hash:23521898-->
- `config.ts` — Domain types for the full ServiceConfig and its subsections: tracker, GitHub, repo, polling, workspace, state machine, server. <!--hash:56b711ea-->
- `health.ts` — Health check types: per-probe status, failure kind, subprobe breakdown, and the HealthChecks snapshot interface. <!--hash:5de45c18-->
- `issue.ts` — Domain type for a tracker Issue record including labels, blockers, and lifecycle timestamps. <!--hash:e4019832-->
- `logger.ts` — RisolutoLogger interface contract (debug/info/warn/error/child) used across the codebase. <!--hash:eff63eff-->
- `model.ts` — Domain types for token usage snapshots, reasoning effort levels, and model selections. <!--hash:465ac3a8-->
- `pr.ts` — Domain types for durable PR records and merge policy rules evaluated before auto-merge. <!--hash:93b90400-->
- `runtime.ts` — Runtime snapshot types: per-issue view, workflow column view, stall events, cost samples, and the full RuntimeSnapshot. <!--hash:f804373b-->
- `workflow-run.ts` — WorkflowRunReference type: minimal identity record (id, identifier, title, url) for a workflow run. <!--hash:05dbb8fe-->
- `workspace.ts` — Workspace domain type carrying the resolved path, key, creation flag, and optional git base directory. <!--hash:a5fc5779-->

## src/dispatch/

- `auth.ts` — Express middleware that validates Bearer token on incoming data-plane requests. <!--hash:ba46e411-->
- `client.ts` — Control-plane HTTP client that dispatches runAttempt to a remote data plane over SSE, forwarding abort signals. <!--hash:25d99053-->
- `entrypoint.ts` — Data plane process entry point; starts the Express server on DISPATCH_PORT with DISPATCH_SHARED_SECRET. <!--hash:78e88417-->
- `factory.ts` — Creates a RunAttemptDispatcher as either a local AgentRunner or a remote DispatchClient based on DISPATCH_MODE. <!--hash:1e20802f-->
- `index.ts` — Public re-export barrel for the dispatch module (DispatchClient, createDispatcher, types). <!--hash:06f2fbdf-->
- `server.ts` — Data plane Express server; handles /dispatch (SSE stream) and /dispatch/:runId/abort endpoints behind bearer auth. <!--hash:c4e3322c-->
- `types.ts` — Shared type contracts for the dispatch layer: RunAttemptDispatcher interface, DispatchRequest/Event/StreamMessage shapes, and DataPlaneHealth. <!--hash:2f9ab2bf-->

## src/docker/

- `lifecycle.ts` — Docker container lifecycle helpers: stop, inspect OOM/running state, list by workspace, remove containers and volumes. <!--hash:b50f2211-->
- `spawn.ts` — Builds `docker run` argument arrays for agent sandbox containers, including mounts, env injection, security options, and cache volume init. <!--hash:78e12632-->
- `stats.ts` — Queries `docker stats` for a single container and returns a typed CPU/memory/network snapshot; returns null when unavailable. <!--hash:62b15228-->
- `workspace-mounts.ts` — Resolves extra host paths to mount into Docker containers for git worktree workspaces whose .git points outside the workspace dir. <!--hash:7b692cbb-->

## src/git/

- `git-types.ts` — Shared git primitive types: GitRunner, GitRunResult, PrCreateResult, PrStatusResponse, and GithubApiToolClient interface. <!--hash:7b5a06ae-->
- `github-api-tool.ts` — Agent tool call handler for GitHub API actions (add_pr_comment, get_pr_status); parses untyped tool input and delegates to GithubApiToolClient. <!--hash:0b9900ae-->
- `github-pr-client.ts` — GitHub PR client: creates PRs, adds comments, fetches status/reviews, requests auto-merge, and closes PRs via the GitHub REST and GraphQL APIs. <!--hash:1346201d-->
- `index.ts` — Public barrel for the git module; re-exports GitManager, GitHubPrClient, RepoRouter, port types, and tool-call handler. <!--hash:cd099287-->
- `manager.ts` — GitManager: orchestrates clone, worktree setup, commit, push, PR creation, and diff operations; implements GitIntegrationPort. <!--hash:a5c5f47d-->
- `merge-policy.ts` — Pure function evaluating auto-merge policy rules (labels, file count, diff size, path allowlist) against a PR's current state. <!--hash:a6106a2f-->
- `port.ts` — Git domain port interfaces: GitWorktreePort, GitPostRunPort, GitDiffPort, and the composite GitIntegrationPort used by the orchestrator. <!--hash:14b1a1a8-->
- `pr-monitor.ts` — Background polling service that tracks open PRs, detects merged/closed transitions, emits SSE events, writes checkpoints, and triggers orchestrator reconciliation. <!--hash:1fdc8e29-->
- `pr-review-ingester.ts` — Fetches PR review bodies, PR comments, and inline line-level comments via `gh` CLI; formats them as a Markdown section for agent prompt injection. <!--hash:6e97d4f5-->
- `pr-summary-generator.ts` — Generates a 3-8 bullet Markdown PR summary by running `codex exec` against the branch diff; returns null on any failure for graceful degradation. <!--hash:49d75137-->
- `repo-router.ts` — Routes issues to repo configurations by matching issue labels or identifier prefixes against configured RepoRoute entries. <!--hash:b0ba634a-->
- `worktree-manager.ts` — Stateless git worktree primitives: ensure/sync bare clone, add/attach/remove worktrees, list worktrees, and check branch existence. <!--hash:2fdcf509-->

## src/github/

- `issues-client.ts` — GitHub Issues REST client: fetches, creates, labels, closes, reopens issues and manages labels on a configured owner/repo. <!--hash:634ce13f-->
- `transport.ts` — Low-level GitHub HTTP transport: sends REST and GraphQL requests, resolves auth tokens from env, and raises GitHubApiError on non-2xx responses. <!--hash:262c4fe8-->

## src/health/

- `health-notification-bridge.ts` — Subscribes to health.transition events and dispatches critical or recovery notifications via NotificationManager when a probe transitions to/from down. <!--hash:6f172ea0-->
- `health-runner.ts` — Adaptive sliding-window health runner: ticks registered probes with cadence gating, 3-of-5 hysteresis, persistence, and transition event emission. <!--hash:b2e108e1-->
- `probe-port.ts` — HealthProbe interface and HealthProbeContext type; defines the contract all concrete probe implementations must satisfy. <!--hash:0ae85b6b-->
- `timed-probe.ts` — Shared latency-banding wrapper for health sub-probes; promotes ok status to slow or down when elapsed time exceeds per-probe thresholds. <!--hash:b9b38a5f-->

## src/health/probes/

- `docker-probe.ts` — Three-way Docker health probe: checks daemon liveness, codex image presence, and workspace writability in parallel with typed failure kinds. <!--hash:08789d3c-->
- `github-probe.ts` — Three-way GitHub health probe: validates PAT auth/scopes, checks repo accessibility, and monitors API rate-limit headroom in parallel. <!--hash:fce0d0ea-->
- `linear-probe.ts` — Two-way Linear tracker health probe: validates active workflow state exists on the project and exercises the candidate-issues fetch path. <!--hash:4243eb35-->

## src/health/runtime/

- `docker-runtime.ts` — Concrete DockerProbeRuntime: shells out to `docker` CLI for daemon info and image inspect, and probes workspace writability via fs operations. <!--hash:c0329347-->
- `github-http.ts` — Concrete GithubProbeHttp adapter using GitHubTransport: pings /user, /repos, and /rate_limit with lazy token resolution and cancellation support. <!--hash:0709b558-->

## src/http/

- `alerts-handler.ts` — HTTP handler for GET /api/v1/alerts/history; delegates to NotificationCenter.listAlertHistory with optional limit and rule_name filters. <!--hash:dfdc8297-->
- `attempt-handler.ts` — HTTP handler for GET /api/v1/attempts/:attempt_id; returns attempt detail from the orchestrator or 404 if not found. <!--hash:132642fb-->
- `automations-handler.ts` — HTTP handlers for automation routes: list defined automations, list run history with filters, and trigger an automation run immediately. <!--hash:e597beb4-->
- `checkpoint-handler.ts` — HTTP handler for GET /api/v1/attempts/:attempt_id/checkpoints; loads checkpoint list from the attempt store after verifying the attempt exists. <!--hash:c679e01a-->
- `dep-validator.ts` — Validates that required HttpRouteDeps are present at startup; logs warnings for optional missing deps and throws for misconfigured webhook/trigger setups. <!--hash:bead1fce-->
- `errors.ts` — Shared HTTP error response helpers: issueNotFound (404) and methodNotAllowed (405) with standard JSON error body shape. <!--hash:b42c0c2e-->
- `git-context.ts` — HTTP handler for GET /api/v1/git/context; enriches configured repos with live GitHub data (PRs, commits) and returns active branches from the orchestrator. <!--hash:10a5636f-->
- `model-handler.ts` — HTTP handler for POST /:issue_identifier/model; updates model and reasoning effort override for an in-flight or queued issue via the orchestrator. <!--hash:8ff475bd-->
- `notifications-handler.ts` — HTTP handlers for notification routes: list, mark read, mark all read, and send a Slack test notification. <!--hash:3d89c65c-->
- `openapi-paths.ts` — OpenAPI 3.1 path definition builders for all Risoluto API route groups; assembled by openapi.ts into the full spec. <!--hash:b0516575-->
- `openapi.ts` — Assembles and lazily caches the full OpenAPI 3.1 spec object by composing all path builder functions from openapi-paths.ts. <!--hash:ec794e8d-->
- `pr-handler.ts` — HTTP handler for GET /api/v1/prs; returns all tracked PRs from the attempt store with optional status filter (open/merged/closed). <!--hash:de97ce30-->
- `query-params.ts` — HTTP query-string helpers; parses and validates limit and single-value string parameters from Express requests. <!--hash:4cdcf541-->
- `read-guard.ts` — Express middleware that gate-keeps sensitive GET/HEAD routes behind bearer token or loopback-address checks. <!--hash:a129a3b2-->
- `request-schemas.ts` — Zod request body schemas for POST endpoints (model update, transition, steer, template override, trigger). <!--hash:21038fde-->
- `response-schemas.ts` — Zod response schemas for all API endpoints; drives OpenAPI contract coverage and client type generation. <!--hash:706befe6-->
- `route-helpers.ts` — Shared HTTP handler utilities: observability serializer, config value sanitizer, and refresh reason extractor. <!--hash:41ad8a50-->
- `route-types.ts` — TypeScript interface defining the full dependency injection bag consumed by all HTTP route registrations. <!--hash:deaf07e2-->
- `routes.ts` — Top-level route registration; wires all sub-route groups onto the Express app in canonical order. <!--hash:87ed9057-->
- `server.ts` — Express HTTP server class; sets up middleware stack (tracing, auth guards, JSON parsing) and manages start/stop lifecycle. <!--hash:9edd3719-->
- `service-errors.ts` — Last-resort Express error handler; converts service-layer exceptions into structured JSON 400/500 responses. <!--hash:3921f6b7-->
- `sse.ts` — Server-Sent Events handler; streams internal EventBus emissions to HTTP clients with keep-alive pings. <!--hash:fe17efcd-->
- `swagger-html.ts` — Generates a cached Swagger UI HTML page that loads the OpenAPI spec from /api/v1/openapi.json. <!--hash:aab4d5c7-->
- `template-override-handler.ts` — Handles POST/DELETE /:issue_identifier/template to set or clear a per-issue prompt template override. <!--hash:63dac96d-->
- `token-compare.ts` — Timing-safe token comparison helpers for auth middleware; prevents timing-attack token enumeration. <!--hash:f6e8cd15-->
- `transition-handler.ts` — Handles POST /:issue_identifier/transition; validates the state machine rule, resolves tracker state ID, and applies the transition. <!--hash:cf1e4535-->
- `transitions-api.ts` — Handles GET /api/v1/transitions; returns the allowed state-to-state transition map from the configured state machine. <!--hash:d929b6dd-->
- `trigger-handler.ts` — Handles POST /api/v1/webhooks/trigger; authenticates, deduplicates, and dispatches create_issue, re_poll, and refresh_issue actions. <!--hash:a743a605-->
- `validation.ts` — Reusable Express middleware factories for Zod-based validation of request body, query, and params. <!--hash:76eb230a-->
- `webhook-types.ts` — Type definitions and payload validator for Linear webhook deliveries; extends Express Request with rawBody. <!--hash:c6919c35-->
- `workspace-inventory.ts` — Handles GET/DELETE /api/v1/workspaces; lists workspace directories with status, disk usage, and linked issue metadata. <!--hash:4589a52a-->
- `write-audit.ts` — Appends NDJSON audit entries to a durable log file for every privileged HTTP mutation request. <!--hash:78cee87f-->
- `write-guard.ts` — Express middleware that blocks non-GET mutations from non-loopback addresses unless RISOLUTO_WRITE_TOKEN is valid. <!--hash:bc839bf6-->

## src/http/routes/

- `audit.ts` — HTTP route for GET /api/v1/audit; queries the audit log with filters for table, key, time range, and pagination. <!--hash:b0e033b6-->
- `codex.ts` — HTTP routes for the Codex control-plane admin API: threads, account, MCP servers, and user-input requests. <!--hash:0bbd71dc-->
- `config.ts` — HTTP routes for reading the effective config, and reading/writing the mutable config overlay via REST. <!--hash:a109c76e-->
- `extensions.ts` — Conditional route registration for optional extensions: config, secrets, setup, templates, and audit APIs. <!--hash:d8ffd748-->
- `git.ts` — HTTP routes for /api/v1/prs (PR list) and /api/v1/git/context (repo and branch context). <!--hash:a1434ee7-->
- `issues.ts` — HTTP routes for per-issue actions: abort, model update, template override, attempts, transitions, steer, and detail. <!--hash:8048bb1f-->
- `notifications.ts` — HTTP routes for notifications, automation schedules/runs, and alert history endpoints. <!--hash:81a75a46-->
- `prompt.ts` — HTTP routes for CRUD management of prompt templates and template preview via /api/v1/templates. <!--hash:5c35262c-->
- `secrets.ts` — HTTP routes for listing, setting, and deleting named secrets via /api/v1/secrets. <!--hash:418c7660-->
- `setup.ts` — HTTP routes for the first-run setup wizard: status, auth, keys, project/label creation, and repo routing. <!--hash:c443d188-->
- `system.ts` — Core system HTTP routes: state, observability, runtime info, recovery, metrics, refresh, SSE events, models, transitions, and OpenAPI docs. <!--hash:62256962-->
- `webhooks.ts` — HTTP routes for the trigger API and incoming Linear/GitHub webhook endpoints, with rate limiting. <!--hash:7dca335d-->
- `workflow-runs.ts` — HTTP routes for listing and reading Workflow Run artifacts, events, and run attempts from the archive directory. <!--hash:71374443-->
- `workspaces.ts` — HTTP routes for listing all workspaces (GET) and removing an orphaned workspace by key (DELETE). <!--hash:f1bcefc3-->

## src/linear/

- `board-columns.ts` — Builds the ordered workflow-column projection from runtime issue groups and the configured state machine stages. <!--hash:aff5da57-->
- `client.ts` — Linear GraphQL API client; handles issue fetching, state transitions, webhooks, attachments, and project/label management. <!--hash:7fc9d02d-->
- `errors.ts` — Typed error class for all Linear client failures, carrying a structured error code for caller discrimination. <!--hash:e2902a78-->
- `graphql-tool.ts` — Agent tool call handler for ad-hoc Linear GraphQL queries; validates exactly one operation and proxies to LinearClient. <!--hash:abe74414-->
- `issue-pagination.ts` — Cursor-based pagination helpers for Linear issue queries; handles candidate issues, state-ID fetches, and state-name fetches. <!--hash:636970bb-->
- `issue-parser.ts` — Transforms raw Linear GraphQL issue payloads into typed Issue objects, normalizing labels and blocker relations. <!--hash:dc26a70e-->
- `nightly-failures.ts` — Creates or updates Linear issues from nightly CI failure summaries, deduplicating by fingerprint and managing lifecycle. <!--hash:bcd2e1e3-->
- `nightly-history.ts` — Persists nightly failure run history to disk; tracks consecutive failures and determines when to create, update, or close issues. <!--hash:f336b7c0-->
- `queries.ts` — GraphQL query and mutation builder functions for all Linear API operations used by Risoluto. <!--hash:b0f49f87-->
- `tool-provider.ts` — Exposes the linear_graphql dynamic tool to Codex agent sessions via the TrackerToolProvider interface. <!--hash:5f6d888a-->
- `transition-query.ts` — GraphQL mutation builders for issue state transitions and comment creation. <!--hash:643ab550-->

## src/live/

- `github-app-auth.ts` — Generates GitHub App JWTs and exchanges them for installation access tokens for API authentication. <!--hash:29e6c9c1-->
- `github-app-sandbox-lifecycle.ts` — Live preflight check that exercises the full GitHub App sandbox PR lifecycle: branch, commit, PR, comment, close, cleanup. <!--hash:f74238d2-->
- `preflight-cli.ts` — CLI entry point for running live preflight checks; parses args, resolves env, writes JSON report to output directory. <!--hash:79422770-->
- `preflight.ts` — Orchestrates live preflight checks against Linear, GitHub App, sandbox lifecycle, and model proxy; returns a pass/fail report. <!--hash:75a33e86-->

## src/notification/

- `channel.ts` — Defines NotificationChannel interface, NotificationEvent shape, and severity/verbosity delivery filter helpers. <!--hash:d23a48bc-->
- `desktop.ts` — Delivers desktop notifications via notify-send (Linux), osascript (macOS), or PowerShell toast (Windows). <!--hash:0a94d5f2-->
- `manager.ts` — Fan-out notification dispatcher; routes events to registered channels, deduplicates within a time window, and persists records. <!--hash:8d470052-->
- `notification-center.ts` — HTTP-level service for listing/marking notifications, querying alert history, and sending Slack test messages. <!--hash:f16b79ec-->
- `port.ts` — Storage port interface for notification records: create, list, count, mark-read, and update delivery summary. <!--hash:ed70b2f5-->
- `slack-webhook.ts` — Notification channel that formats events as Slack Block Kit payloads and posts them to a Slack Incoming Webhook URL. <!--hash:bee29b47-->
- `webhook-channel.ts` — Generic webhook notification channel; serializes notification events as JSON and POSTs to a configured URL. <!--hash:7dcb01f2-->
- `webhook-delivery.ts` — Shared HTTP delivery helper for webhook channels; posts JSON with timeout, logs errors, and re-throws on failure. <!--hash:1201585f-->

## src/observability/

- `health.ts` — Defines health surface types and utility functions that roll up component health statuses into a summary with counts. <!--hash:8c2e65f6-->
- `hub.ts` — Central observability hub; manages per-component observers that record metrics, health, traces, and sessions with disk persistence. <!--hash:2bc28f2b-->
- `metrics.ts` — Prometheus-format metrics collector tracking HTTP requests, orchestrator polls, agent runs, and webhook pipeline counters. <!--hash:31799dd1-->
- `snapshot.ts` — Reads and writes per-process component observability snapshots to disk, cleaning up snapshots for dead processes. <!--hash:6d4c5eb0-->
- `tracing.ts` — Express tracing middleware that propagates or generates X-Request-ID, plus helpers to build structured trace records. <!--hash:7906a830-->

## src/orchestrator/

- `context.ts` — Type definitions for OrchestratorContext (full runtime API) and RetryRuntimeContext (subset for retry operations). <!--hash:b0d17ad5-->
- `dispatch.ts` — Re-exports dispatch utilities from the core submodule as the public orchestrator dispatch surface. <!--hash:3fb14d81-->
- `git-post-run.ts` — Commits, pushes, creates a PR, generates a PR summary, and optionally requests auto-merge after a worker run completes. <!--hash:44e337f1-->
- `index.ts` — Public barrel export for the orchestrator module: Orchestrator class and OrchestratorPort interface. <!--hash:c83de849-->
- `issue-locator.ts` — Resolves an issue identifier to its authoritative runtime location (running, retry, completed, or detail view). <!--hash:7097df5d-->
- `lifecycle.ts` — Orchestrator lifecycle helpers: reconciling running/retrying entries, refreshing queue views, cleaning terminal workspaces, and seeding completed claims. <!--hash:490e42c6-->
- `model-selection.ts` — Resolves the active model selection for an issue (default vs. override) and handles live updates to per-issue model overrides. <!--hash:dd8d4d87-->
- `orchestrator.ts` — Main Orchestrator class: tick-driven poll loop that dispatches workers, reconciles state, and handles commands and snapshots. <!--hash:2b09daf9-->
- `outcome-context.ts` — Type definitions for OutcomeContext (shared post-run handler API) and RetryCoordinator (retry/hard-fail dispatch port). <!--hash:ec452def-->
- `port.ts` — OrchestratorPort interface and command/result types for all operations the orchestrator exposes to callers. <!--hash:7698d481-->
- `recovery-types.ts` — Types for startup recovery: RecoveryAssessment, RecoveryResult, and RecoveryReport with per-attempt action outcomes. <!--hash:1cd97856-->
- `recovery.ts` — Startup recovery: scans persisted running attempts, assesses each (resume/cleanup/escalate), and executes the chosen action. <!--hash:6a919f42-->
- `retry-coordinator.ts` — RetryCoordinator implementation: queues retries with backoff, revalidates issue state before launch, and handles launch failures. <!--hash:18f378df-->
- `retry-policy.ts` — Re-exports retry strategy classifier and type from the core module. <!--hash:e3538ceb-->
- `run-lifecycle-coordinator.ts` — Facade that wires orchestrator state, worker launch, lifecycle events, and snapshot reads into a single coordinator object. <!--hash:fea1ff3e-->
- `runtime-types.ts` — Shared TypeScript interfaces for running entries, launch options, and orchestrator dependency injection. <!--hash:3689580f-->
- `snapshot-builder.ts` — Builds RuntimeSnapshot, IssueDetailView, and AttemptDetailView from in-memory state for operator surfaces and API responses. <!--hash:fca727fa-->
- `stall-detector.ts` — Scans running workers for silence exceeding the stall timeout and aborts them, recording stall events for the operator timeline. <!--hash:86f89406-->
- `views.ts` — Utility functions for building RuntimeIssueView objects, detecting hard failures, and computing token usage deltas. <!--hash:7ddf8156-->
- `watchdog.ts` — Periodic background health monitor; classifies orchestrator as healthy, degraded, or critical based on stalls and queue state. <!--hash:17314ece-->
- `worker-failure.ts` — Handles unhandled worker promise rejections; flushes persistence, records failure status, and releases the issue claim. <!--hash:f1a02b5d-->
- `worker-launcher.ts` — Prepares workspace, creates the running entry, persists the attempt record, and hands the agent promise to the lifecycle handler. <!--hash:159e3e6d-->
- `workspace-preparation.ts` — Ensures a workspace exists for an issue, optionally clones the git repo, and emits lifecycle events during preparation. <!--hash:e7c271f8-->

## src/orchestrator/core/

- `dispatch.ts` — Pure functions for sorting issues by dispatch priority and checking whether an issue is blocked by non-terminal blockers. <!--hash:57d9f4b5-->
- `lifecycle-state.ts` — Manages orchestrator lifecycle state: queue/detail view projection, running entry reconciliation, usage tracking, and completed-claims seeding. <!--hash:887dfea5-->
- `retry-policy.ts` — Classifies a Codex error into a retry strategy: hard_fail, retry with delay, compact_and_retry, or default backoff. <!--hash:b4bab77e-->
- `snapshot-projection.ts` — Projects running, retry, and outcome entries into RuntimeIssueView snapshots for the orchestrator API. <!--hash:7e8abded-->

## src/orchestrator/worker-outcome/

- `completion-writeback.ts` — Posts success or failure comments to the tracker and optionally transitions the issue to a configured success state after agent completion. <!--hash:1ba685cd-->
- `finalize.ts` — Terminal outcome handlers: routes each resolved outcome (stop signal, cancellation, operator abort, etc.) to the correct cleanup path. <!--hash:2854df3b-->
- `index.ts` — Entry point for worker outcome handling; prepares state then dispatches to the correct finalize function based on issue and outcome kind. <!--hash:da4d947a-->
- `prepare.ts` — Flushes persistence, removes the running entry, refreshes issue state from tracker, and updates the attempt record before finalization. <!--hash:6c1eec68-->
- `types.ts` — Shared types and helper functions for worker outcome inputs, prepared outcomes, and outcome-to-status mapping. <!--hash:f984014c-->

## src/persistence/sqlite/

- `alert-history-store.ts` — SQLite-backed store for alert firing history; supports create and filtered list queries for rule-based alert audit. <!--hash:6f46aaeb-->
- `attempt-store-sqlite.ts` — SQLite implementation of AttemptStorePort; persists attempt records, events, checkpoints, and pull requests with cost aggregation. <!--hash:4c3a218b-->
- `automation-store.ts` — SQLite-backed store for automation run history; supports create, finish, list, and count operations per automation name. <!--hash:84470c1f-->
- `cost-sample-store.ts` — SQLite time-series store for per-tick cost/token samples; auto-truncates rows outside the retention window on each append. <!--hash:a633ae74-->
- `database.ts` — Opens the SQLite database with WAL mode, applies incremental schema migrations v4–v10, and exposes open/close helpers. <!--hash:56d8c646-->
- `health-probe-store.ts` — SQLite time-series store for per-subsystem health probe samples; retains 7 days of data and supports filtered recent-sample queries. <!--hash:46e04b57-->
- `issue-config-store.ts` — SQLite-backed store for per-issue model overrides and template assignments; survives restarts via the issue_config table. <!--hash:aa4b5931-->
- `mappers.ts` — Converts between Drizzle row shapes and TypeScript domain types for attempts, events, and checkpoints, including token usage flattening. <!--hash:1e02416a-->
- `migrator.ts` — Idempotent one-time migration from legacy JSON/JSONL archive files into the SQLite attempts and events tables on first boot. <!--hash:44b8fe60-->
- `notification-store.ts` — SQLite-backed store for operator notifications; supports create, list, mark-read, and delivery-summary update operations. <!--hash:dcef8842-->
- `operator-persistence.ts` — Groups the three operator-facing SQLite stores (notifications, automation runs, alert history) into a single object. <!--hash:1c9dca3c-->
- `query-helpers.ts` — Clamps a pagination limit to [1, 500] with a default of 100 for list queries. <!--hash:f0eba5b3-->
- `runtime.ts` — Owns the single SQLite connection, runs migration, seeds defaults, and constructs all stores that share the connection. <!--hash:e1723c81-->
- `schema.ts` — Drizzle ORM table definitions for all SQLite tables: attempts, events, config, secrets, templates, checkpoints, PRs, and time-series. <!--hash:b46fa942-->
- `store-utils.ts` — Normalises a caller-supplied limit to a bounded integer for time-series ring-buffer stores. <!--hash:28364124-->
- `webhook-inbox.ts` — SQLite-backed webhook inbox with dedup by delivery_id, status lifecycle management, retry queue, DLQ, and backlog metrics. <!--hash:17532958-->
- `webhook-persistence.ts` — Wraps SqliteWebhookInbox with convenience accessors for snapshots, recent deliveries, stats, and retry queues. <!--hash:2df6cc2d-->

## src/prompt/

- `port.ts` — TemplateStorePort interface for prompt template CRUD and preview; decouples consumers from the SQLite/Liquid implementation. <!--hash:0025abb0-->
- `resolver.ts` — Factory that returns an async function resolving the active prompt template for an issue via a 4-level override priority chain. <!--hash:066707e8-->
- `store.ts` — SQLite-backed prompt template store with Liquid validation, CRUD operations, and sample-context preview rendering. <!--hash:fa148767-->
- `template-policy.ts` — Validates Liquid prompt templates against a strict allowlist of output expressions and if/endif control flow only. <!--hash:b183f4a2-->
- `types.ts` — Shared PromptTemplate and PreviewResult type definitions used by both the port and store modules. <!--hash:01b2daca-->

## src/secrets/

- `db-store.ts` — DB-backed secrets store; encrypts each value with per-row AES-256-GCM, stores ciphertext in SQLite, decrypts on read. <!--hash:0c378fa8-->
- `port.ts` — SecretsPort interface for encrypted secret storage; allows test doubles to be injected without the file-system implementation. <!--hash:e014264d-->
- `store.ts` — File-backed secrets store; encrypts all secrets as a single AES-256-GCM envelope on disk with an atomic write and audit log. <!--hash:0fc7ab9f-->

## src/setup/

- `detect-default-branch.ts` — Express handler for detecting a GitHub repo's default branch via the setup service. <!--hash:ec7cb4dd-->
- `device-auth.ts` — PKCE OAuth flow for Codex/OpenAI login: creates sessions, runs local callback server on port 1455, exchanges codes for tokens, and persists auth.json. <!--hash:fea7df8e-->
- `port.ts` — Type definitions and SetupServiceError for the setup domain: port interface, deps, and data shapes. <!--hash:ec3577a7-->
- `repo-route-handlers.ts` — Express handlers to list, save, and delete repo-to-identifier-prefix routing entries. <!--hash:4e46ad44-->
- `setup-service.ts` — Core setup service implementation: master key, tracker selection, API key storage, PKCE flow, repo routes, and reset logic. <!--hash:508a8362-->
- `setup-status.ts` — Helpers that read setup completion signals from the config overlay and filesystem (Codex auth file, repo routes, tracker kind). <!--hash:7ff47865-->

## src/setup/handlers/

- `codex-auth.ts` — Express handler that accepts a raw Codex auth.json payload and persists it via the setup service. <!--hash:d3c29b4a-->
- `github-token.ts` — Express handler that validates and saves a GitHub personal access token via the setup service. <!--hash:56ab403c-->
- `index.ts` — Barrel re-export for all setup HTTP route handlers. <!--hash:f9dcf710-->
- `label.ts` — Express handler that creates the Risoluto label in the configured Linear project. <!--hash:9f7651af-->
- `linear-project.ts` — Express handlers to list available Linear projects and select one by slugId during setup. <!--hash:7e27a346-->
- `master-key.ts` — Express handler that generates or accepts a master encryption key and initialises the secrets store. <!--hash:91826fad-->
- `openai-key.ts` — Express handler that validates an OpenAI API key and optional custom provider config, then persists them. <!--hash:3ea9e12e-->
- `pkce-auth.ts` — Express handlers for starting, polling status of, and cancelling a PKCE OAuth flow. <!--hash:7832a75a-->
- `project.ts` — Express handler that creates a new Linear project by name during setup. <!--hash:a4853f69-->
- `reset.ts` — Express handler that resets all setup configuration by delegating to the setup service. <!--hash:50aa5ec1-->
- `status.ts` — Express handler that returns the current setup completion status snapshot. <!--hash:16d0096f-->
- `test-issue.ts` — Express handler that creates a smoke-test issue in the configured tracker to verify setup. <!--hash:312a5964-->

## src/state/

- `defaults.ts` — Default active and terminal state name lists used when no custom state machine is configured. <!--hash:a8083e3f-->
- `machine.ts` — Generic StateMachine that models workflow stages and validates issue state transitions with configurable explicit or permissive rules. <!--hash:281061ef-->
- `policy.ts` — Policy helpers that classify issue states (active, terminal, gate, todo) and list workflow stages from ServiceConfig, with WeakMap-backed caching. <!--hash:0f766a72-->

## src/tracker/

- `factory.ts` — Factory that instantiates the correct tracker adapter (Linear or GitHub) and associated tool provider from ServiceConfig. <!--hash:5991f46a-->
- `github-adapter.ts` — TrackerPort adapter for GitHub Issues: maps issue operations and setup provisioning to GitHubIssuesClient calls. <!--hash:472d46ac-->
- `index.ts` — Barrel re-export for the tracker subsystem public surface. <!--hash:ac59c76b-->
- `linear-adapter.ts` — TrackerPort adapter for Linear: delegates all issue and provisioning operations to LinearClient. <!--hash:6273377a-->
- `port.ts` — TrackerPort interface and related input/result types that decouple orchestration from any specific issue tracker. <!--hash:fff3046d-->
- `tool-provider.ts` — TrackerToolProvider port for exposing tracker-specific dynamic tools to Codex sessions, plus a no-op NullTrackerToolProvider. <!--hash:6346e43f-->

## src/utils/

- `retry.ts` — Retry utilities with jittered exponential backoff: void variant swallows final error, value variant rethrows. <!--hash:a0c61714-->
- `tool-call-result.ts` — Shared ToolCallResult wrapper with success/failure constructors for MCP-style tool-call handlers. <!--hash:56468710-->
- `type-guards.ts` — Narrowing helpers and error-to-string utilities used throughout the codebase. <!--hash:ff8bc64a-->

## src/webhook/

- `composition.ts` — Compatibility shim that exposes initWebhookInfrastructure and buildWebhookHandlerDeps as a stable wiring surface over webhook/runtime. <!--hash:fed27855-->
- `delivery-workflow.ts` — WebhookDeliveryWorkflow: deduplicates incoming webhook deliveries via a persistent inbox before processing them. <!--hash:57ac6f22-->
- `github-handler.ts` — Express handler for GitHub webhook events: verifies HMAC signature, validates delivery, and triggers targeted orchestrator refreshes for issue events. <!--hash:ae69be79-->
- `health-tracker.ts` — State machine that tracks Linear webhook health (disconnected/connected/degraded) via delivery signals and periodic subscription checks. <!--hash:013c6eea-->
- `linear-handler.ts` — Express handler for Linear webhook events: verifies HMAC, validates replay window, deduplicates, and dispatches issue/comment events to the orchestrator. <!--hash:8cd79661-->
- `port.ts` — WebhookPort interface: snapshot type and contract for building handler deps and querying webhook state. <!--hash:c28325ba-->
- `registrar.ts` — WebhookRegistrar: resolves a webhook signing secret via manual config, stored secret reuse, or auto-creation in Linear. <!--hash:bba84dfd-->
- `runtime.ts` — Re-export shim aliasing WebhookService as WebhookRuntime and createWebhookService as createWebhookRuntime. <!--hash:7d9500be-->
- `service.ts` — Creates the webhook service: wires health tracker, inbox, registrar, and handler deps together from config and dependencies. <!--hash:2474eae0-->
- `signature.ts` — HMAC-SHA256 signature verification for Linear and GitHub webhooks using timing-safe comparison. <!--hash:c2612a99-->
- `types.ts` — Shared type contracts for the webhook integration module: health status, health state, and inbox stats. <!--hash:7e6c4d9c-->

## src/workflow-run/

- `artifacts.ts` — Core workflow run domain model: types, record creation, event append/read, and transition recording to disk. <!--hash:9fab4d11-->
- `linear-intake.ts` — Accepts a Linear-triggered workflow run: creates and persists the run record from a Linear issue event. <!--hash:b1d466a5-->
- `list-artifacts.ts` — Lists all workflow runs from the archive directory, sorted newest-first. <!--hash:2a1a1ab0-->
- `role-execution-artifacts.ts` — Records a completed role execution: writes the artifact JSON file and appends the completion event. <!--hash:94b2a5f4-->
- `run-attempt-projection.ts` — Projects run attempt summaries by replaying workflow run events from the event log. <!--hash:c23a4765-->
- `run-attempts.ts` — Manages run attempt lifecycle transitions: start, complete, fail, and cancel, each appending an event. <!--hash:a5c4e40d-->
- `worker-process.ts` — Records a worker process outcome (succeeded or failed) as a workflow run event. <!--hash:4263adeb-->
- `workspace-lifecycle.ts` — Records workspace preparation and cleanup events into the workflow run event log. <!--hash:3301ba1c-->

## src/workspace/

- `index.ts` — Public barrel for the workspace module: re-exports WorkspaceManager, PathRegistry, and port types. <!--hash:85dfd38d-->
- `manager.ts` — WorkspaceManager: creates, prepares, hooks, and removes workspaces with per-key mutex and auto-commit safety. <!--hash:9d7c2f2e-->
- `path-registry.ts` — PathRegistry: translates container-side paths to host paths using a longest-prefix mapping. <!--hash:af011704-->
- `paths.ts` — Workspace path utilities: safe PATH builder, root containment check, identifier sanitizer, and path resolver. <!--hash:20e53dbe-->
- `port.ts` — WorkspacePort interface and WorkspaceRemovalResult type: the seam for workspace lifecycle operations. <!--hash:081fa23b-->

## tests/

- `helpers.ts` — Shared test factory functions: mock logger, mock Express response, JSON/text fetch response builders. <!--hash:d876dc76-->

## tests/agent/

- `codex-request-handler.test.ts` — Tests for handleCodexRequest: approval auto-accept, tool dispatch to Linear/GitHub, and fatal failure paths. <!--hash:ac4d73d9-->
- `json-rpc-connection.test.ts` — Tests for JsonRpcConnection: line buffering, response routing, timeouts, exit cleanup, and interruptTurn. <!--hash:e8039404-->

## tests/agent-runner/

- `abort-outcomes.test.ts` — Tests for outcomeForAbort, classifyRunError, and failureOutcome abort/error classification helpers. <!--hash:fa142816-->
- `agent-runner.test.ts` — Integration tests for AgentRunner.runAttempt against the mock-codex-server fixture covering full protocol flow. <!--hash:d6f628ac-->
- `agent-session-port.test.ts` — Tests that AgentRunner exposes steering through AgentSessionPort without Docker-specific deps in the caller. <!--hash:7d5bbe5a-->
- `attempt-executor.test.ts` — Tests for DefaultAttemptExecutor lifecycle: hook ordering, self-review events, init failures, and abort wiring. <!--hash:27493fd1-->
- `docker-session.test.ts` — Tests for createDockerSession: spawn, container lifecycle, abort wiring, cleanup, and steering. <!--hash:16422b66-->
- `error-classifier.test.ts` — Tests for extractCodexErrorInfo: field extraction, fallback paths, retryAfterMs, and missing fields. <!--hash:85c2cb2e-->
- `exit-classifier.test.ts` — Tests for classifyExitState: OOM detection, port_exit, abort bypass, and fatal failure priority. <!--hash:059ad98c-->
- `helpers.test.ts` — Tests for all agent-runner helper utilities: extractors, sanitizers, auth checks, and sandbox upgrade logic. <!--hash:ded521f5-->
- `model-validation.test.ts` — Tests for fetchAvailableModels: pagination, connection errors, malformed responses, and id filtering. <!--hash:ff87c639-->
- `notification-handler.test.ts` — Tests for handleNotification: full coverage of JSON-RPC notification-to-lifecycle-event mapping. <!--hash:e4799bca-->
- `preflight.test.ts` — Tests for runPreflight: command sequencing, first-failure stopping, and connection error handling. <!--hash:93bee277-->
- `self-review.test.ts` — Tests for runSelfReview: pass/fail classification, non-fatal errors, missing summary fallback, and streaming. <!--hash:44947e53-->
- `session-helpers.test.ts` — Tests for waitForStartup (timeout, abort, exit) and buildDynamicTools (schema and warning coverage). <!--hash:77a8c7b4-->
- `session-init.test.ts` — Tests for initializeSession: full protocol handshake, thread resume/rollback, template errors, and auth failures. <!--hash:d4725fd0-->
- `signal-detection.test.ts` — Tests for detectStopSignal: RISOLUTO_STATUS text patterns and structured JSON status output. <!--hash:4f70c76c-->
- `thread-compact.test.ts` — Tests for compactThread: success logging and failure warning paths. <!--hash:a0916a81-->
- `turn-executor.test.ts` — Extensive tests for executeTurns: turn lifecycle, context compaction, abort, errors, and event emission. <!--hash:fd561749-->
- `turn-state.test.ts` — Tests for TurnState primitives: completion buffering, reasoning buffers, abort/timeout, and review summaries. <!--hash:34a6d8bb-->

## tests/alerts/

- `alert-pipeline.test.ts` — Integration tests for AlertPipeline: event delivery, cooldown suppression, and partial-failure recording. <!--hash:2eb3248c-->
- `engine.test.ts` — Integration tests for AlertEngine: event routing, cooldown, disabled rules, feedback-loop guard, and history. <!--hash:52ea8d2f-->
- `history-store.test.ts` — Tests for AlertHistoryStore (SQLite): create, ordering, filtering, limit normalization, and cloning safety. <!--hash:9898b357-->

## tests/audit/

- `logger-sse.test.ts` — Tests that AuditLogger emits audit.mutation on the event bus when one is configured. <!--hash:6759f00d-->
- `logger.test.ts` — Tests for AuditLogger: config/secret/template logging, filtering, pagination, ordering, and count queries. <!--hash:e99df016-->

## tests/automation/

- `runner-coverage.test.ts` — Extended unit tests for AutomationRunner covering report/findings/implement modes, event bus emissions, error propagation, and notify edge cases. <!--hash:8e35a23d-->
- `runner.test.ts` — Core unit tests for AutomationRunner: report run persistence, missing-repo skip, and implement-mode tracker issue creation with targeted refresh. <!--hash:9ef867c4-->
- `scheduler-coverage.test.ts` — Extended unit tests for AutomationScheduler covering stop lifecycle, runNow delegation, disabled automations, config-change sync, and sorting. <!--hash:4bd613d2-->
- `scheduler.test.ts` — Core unit tests for AutomationScheduler: cron scheduling, invalid expression handling, and task teardown on config change. <!--hash:a52c30e4-->

## tests/cli/

- `bootstrap.test.ts` — Unit tests for CLI bootstrap helpers: parseCliArgs port validation, master.key reading/trimming, and transient workspace dir cleanup. <!--hash:f775a8b8-->
- `index.integration.test.ts` — Integration tests for CLI index helpers: --data-dir flag resolution, readMasterKeyFile, cleanupTransientWorkspaceDirs, safeStartConfigStore, and evaluateSetupMode. <!--hash:c6df9c23-->
- `notifications.test.ts` — Unit tests for CLI notification wiring: wireNotifications channel registration from config, channel removal on rewire, and watchConfigChanges port-change warnings. <!--hash:1ab8a2e3-->
- `package-bin.test.ts` — Integration test verifying the bin/risoluto wrapper resolves dist/cli/index.js correctly when invoked through a symlink from node_modules/.bin. <!--hash:c7c51db5-->
- `runtime-providers.test.ts` — Unit tests for runtime provider factories: repo router rebuilds routes on each match and GitHub tool provider re-creates GitManager with latest config. <!--hash:22d623d8-->
- `services.integration.test.ts` — Integration tests for createServices using real SQLite: service graph assembly, webhook infrastructure wiring, and persistence runtime injection. <!--hash:86ee03fe-->
- `services.test.ts` — Unit tests for createServices with mocked dependencies: validates returned service shape, wiring of Orchestrator/HttpServer, template resolution, and codex control-plane scoping. <!--hash:f4652329-->
- `workflow-run-start.integration.test.ts` — Integration tests for workflow-run CLI commands: start, list, event append/list, role-execution, run-attempt lifecycle, gate/transition/hook recording, and workspace events. <!--hash:87548868-->

## tests/codex/

- `admin-service.test.ts` — Unit tests for CodexAdminService: verifies account, MCP, and thread mutations are routed through the control plane boundary with correct RPC method names. <!--hash:d17085dc-->
- `auth-file.integration.test.ts` — Integration tests for auth-file helpers: buildCodexAuthRecord, normalizeCodexAuthRecord/Json, and readCodexAuthTokens with flat and nested token formats. <!--hash:817cc5c0-->
- `auth-file.test.ts` — Unit tests for auth-file normalizers and readers covering flat-to-nested migration, passthrough cases, edge inputs, and token extraction precedence. <!--hash:4b8f5ead-->
- `control-plane.test.ts` — Unit tests for CodexControlPlane: config isolation, CODEX_HOME setup, capabilities reporting, request routing, pending user-input requests, shutdown drain, and JSON-RPC error classification. <!--hash:20ce3f30-->
- `model-list.test.ts` — Unit tests for fetchCodexModels: JSON-RPC parsing, hidden model filtering, API key passthrough, ENOENT/timeout/exit fallbacks, caching TTL, and non-JSON line tolerance. <!--hash:d8ac906c-->
- `protocol.test.ts` — Unit tests for JSON-RPC 2.0 protocol helpers: createRequest, createSuccessResponse, createErrorResponse, and all four type-guard predicates. <!--hash:733b5adb-->
- `runtime-config.integration.test.ts` — Integration tests for codex runtime config: TOML key formatting, host-URL rewriting for Docker, provider TOML generation, and prepareCodexRuntimeConfig auth.json handling. <!--hash:50146cf6-->
- `runtime-config.test.ts` — Unit tests for buildConfigToml, prepareCodexRuntimeConfig, and getRequiredProviderEnvNames covering provider configs, openai_login auth normalization, and error cases. <!--hash:aee9518c-->
- `token-refresh.test.ts` — Unit tests for isTokenExpired and refreshAccessToken: expiry detection via expired field and JWT exp, OAuth token exchange, flat-to-nested upgrade, and error cases. <!--hash:b26f3f45-->

## tests/config/

- `api.test.ts` — Integration tests for registerConfigApi HTTP routes: effective config GET, overlay PUT/PATCH/DELETE, dotted-key expansion, validation errors, and method-not-allowed. <!--hash:e5a8a3fb-->
- `builders.test.ts` — Unit tests for config section builders: tracker endpoint normalization, polling default, camelCase alias fallbacks, and multi-section camelCase preservation. <!--hash:4a301473-->
- `coercion.property.test.ts` — Property-based tests using fast-check for all config coercion helpers, verifying type safety and invariants over arbitrary inputs. <!--hash:93b79260-->
- `coercion.test.ts` — Unit tests for config coercion helpers (asRecord, asString, asNumber, asBoolean, asStringMap, asNumberMap, asStringArray, asRecordArray, asLooseStringArray). <!--hash:fba58692-->
- `db-store.test.ts` — Unit tests for DbConfigStore: overlay CRUD operations, ConfigStore surface (getConfig/getWorkflow/getMergedConfigMap), persistence, subscribe/unsubscribe, and dangerous key rejection. <!--hash:38e6d34e-->
- `derivation-pipeline.test.ts` — Unit tests for deriveServiceConfig pipeline: full derivation through boundary, mergedConfigMap input precedence, tracker endpoint normalization, and polling defaults. <!--hash:65500044-->
- `live-preflight-config.test.ts` — Unit tests for live preflight config: dotenv file loading, GitHub App private key file preference, and locked env name validation. <!--hash:05442b28-->
- `merge.test.ts` — Unit tests for deepMerge and cloneConfigMap: recursive merge, array replacement, type coercion at keys, non-mutation, and clone independence. <!--hash:135f3951-->
- `normalizers.test.ts` — Unit tests for config normalizers: codex auth mode, provider, notifications, GitHub, repos, state machine, approval policy, reasoning effort, and turn sandbox policy. <!--hash:00327e9f-->
- `notification-config.test.ts` — Unit tests for notification config normalization: slack channel mirroring, webhook/desktop channels, host allowlist enforcement, triggers, automations, and alerts. <!--hash:eb33dff7-->
- `overlay-helpers.test.ts` — Unit tests for overlay-helpers: isDangerousKey, normalizePathExpression, stableStringify, mergeOverlayMaps, setOverlayPathValue, and removeOverlayPathValue with prototype-pollution guards. <!--hash:eadb9efe-->
- `overlay.test.ts` — Integration tests for ConfigOverlayStore: set/delete persistence, deep patch merging, file-watch reload, concurrent mutation serialization, and prototype-pollution rejection. <!--hash:25e9a2ba-->
- `pr-policy-schema.test.ts` — Unit tests for mergePolicyConfigSchema and agentConfigSchema PR/CI fields: defaults, validation rules, autoMerge block, and autoClaim behavior. <!--hash:37fdaa22-->
- `resolvers.property.test.ts` — Property-based tests for resolveConfigString and resolvePathConfigString using fast-check: type safety, idempotency, and secret resolution invariants. <!--hash:dad05a25-->
- `resolvers.test.ts` — Unit tests for resolveConfigString and resolvePathConfigString: $VAR expansion, $SECRET:name lookup, ~ home expansion, $TMPDIR substitution, and path-scoped multi-var resolution. <!--hash:c416b08b-->
- `schemas.test.ts` — Unit tests for all Zod config schemas: tracker, workspace, agent, codex, sandbox, provider, reasoningEffort, polling, server, notification, gitHub, repo, and stateMachine schemas. <!--hash:8f8be6c9-->
- `store.test.ts` — Unit tests for ConfigStore: lifecycle, overlay merging, workflowStore hydration, subscriber management, clone isolation, self-routing repo warning, and last-known-good fallback. <!--hash:f26194c3-->
- `test-model-profiles.test.ts` — Unit tests for resolveTestModelProfile: verifies locked env names, default values, env var overrides, and the set of named central test profiles. <!--hash:ed164908-->
- `url-policy.test.ts` — Unit tests for config URL policy: tracker/Slack/GitHub/notification webhook allowlist enforcement and deriveServiceConfig rejection of disallowed endpoints. <!--hash:cb7bc8fc-->
- `validators.test.ts` — Unit tests for dispatch config validators: tracker fields, codex auth modes, provider env, and repo self-routing warnings. <!--hash:f6ce541f-->
- `webhook.test.ts` — Unit tests for webhook config schema validation and deriveServiceConfig webhook derivation including env-var resolution. <!--hash:53cdf8cf-->

## tests/core/

- `attempt-analytics.test.ts` — Unit tests for attempt sorting (descending) and duration summing helpers in attempt-analytics. <!--hash:dfba45e7-->
- `attempt-store-port.test.ts` — Smoke test asserting attempt-store-port is a pure contract module that exports no runtime values. <!--hash:949a8199-->
- `content-sanitizer.property.test.ts` — Property-based tests (fast-check) for content sanitizer: output length bounds, secret redaction, idempotency, and passthrough invariants. <!--hash:7441e366-->
- `content-sanitizer.test.ts` — Unit tests for sanitizeContent and redactSensitiveValue: truncation, regex redaction of known secret patterns, JSON structural redaction, and clone fallback. <!--hash:d2c6e8f0-->
- `error-tracking.test.ts` — Unit tests for error-tracking module: no-op fallback, Sentry activation on DSN, breadcrumb/context capture, DSN redaction, and flush. <!--hash:f273fa48-->
- `event-bus.integration.test.ts` — Integration tests for TypedEventBus covering on/emit, off, once, onAny/offAny, emit edge cases, and destroy across multi-handler scenarios. <!--hash:021fb007-->
- `event-bus.test.ts` — Unit tests for TypedEventBus: on/off/once/onAny/offAny/destroy behavior and compile-time type safety check. <!--hash:41444257-->
- `logger.test.ts` — Unit tests for logger: resolveLogFormat env var handling, logfmt and JSON output format, child logger inheritance, and createLogger integration. <!--hash:a6b395f9-->
- `model-pricing.property.test.ts` — Property-based tests for model pricing: known models return positive prices, cost scales linearly, unknown models return null. <!--hash:1f5d32c8-->
- `model-pricing.test.ts` — Unit tests for lookupModelPrice: spot-checks known model prices, null for unknowns, case-sensitivity, and full seeded-model coverage. <!--hash:918df7d5-->
- `signal-detection.property.test.ts` — Property-based tests for detectStopSignal: done/blocked marker detection, JSON status parsing, idempotency, and output domain invariants. <!--hash:db06ca76-->

## tests/dispatch/

- `auth.test.ts` — Unit tests for bearerAuth Express middleware: missing, wrong, malformed, and correct Authorization header handling. <!--hash:f787cafa-->
- `client.test.ts` — Unit tests for DispatchClient: POST headers, workflow-run body, HTTP error handling, and abort signal forwarding. <!--hash:5dfc98e6-->
- `factory.test.ts` — Unit tests for createDispatcher factory: selects AgentRunner vs DispatchClient based on DISPATCH_MODE, validates shared secret requirement. <!--hash:1de4bea2-->
- `parity.test.ts` — Gateway parity integration tests verifying RunAttemptDispatcher contract through a real HTTP data plane: event forwarding, outcome passthrough, abort propagation, and error surfacing. <!--hash:b6a3078f-->
- `server.test.ts` — Unit tests for the data plane Express server: /health, /dispatch auth/validation/abort routing, and workflow-run-id addressing. <!--hash:293105fc-->
- `types.test.ts` — Compile-time type check asserting AgentRunner satisfies the RunAttemptDispatcher interface. <!--hash:edd5191f-->

## tests/docker/

- `lifecycle.test.ts` — Unit tests for Docker lifecycle helpers: stop, remove, volume removal, OOM-kill and running-state inspection with not-found error swallowing. <!--hash:398b5b53-->
- `spawn.test.ts` — Unit tests for buildDockerRunArgs: container naming, volume mounts, security flags, resource limits, egress allowlist, observability labels, and PathRegistry translation. <!--hash:aca843d5-->
- `stats.test.ts` — Unit tests for getContainerStats: JSON parsing of docker stats output, null on error or empty output. <!--hash:802bfc98-->
- `workspace-mounts.test.ts` — Unit tests for resolveWorkspaceExtraMountPaths: resolves shared git commondir for worktree .git pointer files. <!--hash:cccbe08a-->

## tests/fixtures/

- `mock-codex-server.mjs` — Scriptable mock Codex JSON-RPC server for integration tests; simulates turn sequences, approval requests, tool calls, and scenario-driven failure modes. <!--hash:2101aee2-->

## tests/fixtures/codex-home-required-mcp/

- `config.toml` — Test fixture Codex config with a required MCP server entry, used to exercise MCP-required failure scenarios in integration tests. <!--hash:942e87c2-->

## tests/git/

- `github-api-tool.test.ts` — Unit tests for handleGithubApiToolCall: get_pr_status, add_pr_comment, unsupported actions, malformed input, and downstream client errors. <!--hash:d4e77416-->
- `github-pr-client.test.ts` — Unit tests for GitHubPrClient: PR creation, duplicate fallback, comment posting, status retrieval, auto-merge GraphQL, token injection, and response parsing edge cases. <!--hash:7f86747e-->
- `manager.test.ts` — Unit tests for GitManager: clone, branch slugging, worktree setup/attach/sync/remove, commit-and-push, force-push, PR creation, and token auth injection. <!--hash:8da8b159-->
- `merge-policy.test.ts` — Unit tests for evaluateMergePolicy: enabled flag, excludeLabels, requireLabels, maxChangedFiles, maxDiffLines, allowedPaths, and check ordering. <!--hash:9607178b-->
- `pr-monitor.test.ts` — Unit tests for PrMonitorService: start/stop idempotency, merge/close detection, SSE event emission, checkpoint recording, error recovery, and orchestrator refresh triggering. <!--hash:45b42aa7-->
- `pr-review-ingester.test.ts` — Unit tests for PR review ingestion: fetchPRReviewFeedback via gh CLI and formatPRFeedbackForPrompt markdown formatting. <!--hash:a39bee84-->
- `pr-summary-generator.test.ts` — Unit tests for generatePrSummary: empty/oversized diff short-circuit, codex JSON output parsing, and spawn error handling. <!--hash:f46c7b37-->
- `repo-router.test.ts` — Unit tests for matchIssue and RepoRouter: label-first routing, identifier-prefix matching, whitespace/case normalization, blank-URL skipping, and null fallback. <!--hash:0b6571cc-->
- `worktree-manager.test.ts` — Unit tests for worktree-manager functions: repo key derivation, bare clone/fetch, worktree add/attach/remove/list, branch existence, and cleanliness detection. <!--hash:5e836b1b-->

## tests/github/

- `issues-client-extended.test.ts` — Extended unit tests for GitHubIssuesClient: addLabel, removeLabel, closeIssue, reopenIssue, createComment, createIssue, ensureLabel, token fallback, and retry wrappers. <!--hash:583fa0e9-->
- `issues-client.test.ts` — Unit tests for GitHubIssuesClient: normalizeGitHubIssue mapping, fetchOpenIssues URL/errors, fetchIssuesByNumbers parallelism, and HTTP/transport error codes. <!--hash:b8b0b5f1-->
- `transport.test.ts` — Unit tests for GitHubTransport: authorization scheme injection, anonymous request support, and abort signal forwarding. <!--hash:77e8e7fb-->

## tests/health/

- `health-notification-bridge.test.ts` — Unit tests for attachHealthNotificationBridge: critical notification on down, info on recovery, ignored non-critical transitions, and unsubscribe handle. <!--hash:accb5378-->
- `health-runner.test.ts` — Unit tests for HealthRunner: probe aggregation, steady-state cadence, watch mode, store persistence, transition events, hysteresis, parallel execution, and lastSuccessAt/lastFailureAt tracking. <!--hash:58f7ab2d-->

## tests/health/probes/

- `docker-probe.test.ts` — Unit tests for DockerProbe: happy path, daemon unreachable, missing image, workspace ENOSPC/ENOENT, and slow-latency promotion. <!--hash:47b18e61-->
- `github-probe.test.ts` — Unit tests for GithubProbe: auth, rate-limit, repo subprobes, latency banding, and dedup logic. <!--hash:1e843351-->
- `linear-probe.test.ts` — Unit tests for LinearProbe: happy path, config_drift, auth_failure, rate_limited, unreachable, and unknown subprobe states. <!--hash:504d3369-->

## tests/health/runtime/

- `github-http.test.ts` — Unit tests for createGithubHttpAdapter: token resolution, request headers, transport failure mapping, and rate-limit parsing. <!--hash:08f11a7a-->

## tests/helpers/

- `http-server-harness.ts` — Two-tier integration test harness: starts a real HttpServer on a dynamic port with SQLite, event bus, and webhook stubs; exposes teardown. <!--hash:ec443e28-->
- `quarantine.ts` — Vitest setup file that reads quarantine.json and skips matching tests via beforeEach unless QUARANTINE_ENFORCE=false. <!--hash:479457d2-->

## tests/http/

- `alerts-handler.test.ts` — Unit test for handleListAlertHistory: verifies stored alert entries are returned with correct shape and status 200. <!--hash:560dd3af-->
- `api-contracts.test.ts` — Inline snapshot tests freezing the response key/type structure for major API endpoints against a live Express instance. <!--hash:7d7dd59d-->
- `attempt-handler.test.ts` — Unit tests for handleAttemptDetail: 200 on found, 404 on missing, and numeric attempt_id coercion to string. <!--hash:d7d9e167-->
- `audit-api.integration.test.ts` — Integration tests for GET /api/v1/audit: filtering by tableName/key/path/timestamp, pagination, limit clamping, and method guards. <!--hash:d7034bda-->
- `automations-handler.test.ts` — Unit tests for automation HTTP handlers: list automations, list runs from SQLite, and trigger a manual run through the scheduler. <!--hash:4d5ebad1-->
- `checkpoints-api.integration.test.ts` — Integration tests for GET /api/v1/attempts/:id/checkpoints: 200 with data, 404 for unknown attempt, 503 without store. <!--hash:35419af0-->
- `codex-routes.test.ts` — Unit tests for Codex admin routes: admin snapshot, capabilities, thread listing, unsupported method 501, missing control plane 503, and model fallback. <!--hash:60dbae86-->
- `dep-validator.test.ts` — Unit tests for validateHttpDeps: throws when webhook or tracker deps are missing for configured features, passes when features are unconfigured. <!--hash:59e17e49-->
- `git-context.test.ts` — Unit tests for GET /api/v1/git/context: config-only mode, GitHub-enriched mode, custom API base URL, empty repos, and graceful degradation on API failure. <!--hash:f7658e87-->
- `github-webhook-handler.test.ts` — Unit tests for handleWebhookGitHub: signature verification, targeted refresh, worker stop on close, dedup, 401/400/503 error paths. <!--hash:76c0f0e5-->
- `load.test.ts` — Load tests using autocannon for /api/v1/state, /api/v1/runtime, /metrics, and POST /api/v1/refresh: asserts zero errors and p99 latency bounds. <!--hash:64369590-->
- `model-handler.integration.test.ts` — Integration tests for POST /api/v1/:id/model through the full HTTP stack: 202 success, 404 not found, 400 validation, and 405 method guard. <!--hash:0c1e574f-->
- `model-handler.test.ts` — Unit tests for handleModelUpdate: 404 on null orchestrator result, 202 success shape, camelCase effort alias, null effort passthrough. <!--hash:bf54c2ec-->
- `notifications-handler.test.ts` — Unit tests for handleTestSlackNotification: 503 without config, 400 missing channel, dispatch to enabled Slack channel, and error code mapping. <!--hash:e907d2e2-->
- `openapi-contracts.integration.test.ts` — AJV integration tests validating every spec-covered API response against compiled OpenAPI 3.1 schemas through a real HttpServer. <!--hash:a17468bb-->
- `openapi-paths.test.ts` — Unit tests for OpenAPI path builder functions: verifies route existence, operationIds, parameters, response codes, and no cross-builder duplicates. <!--hash:4a454e2d-->
- `openapi.test.ts` — Unit tests for getOpenApiSpec and getSwaggerHtml: validates OpenAPI 3.1 document structure, security schemes, route coverage, and HTML output. <!--hash:a45e4848-->
- `pr-handler.test.ts` — Integration tests for GET /api/v1/prs against a real SQLite store: lists all PRs, filters by status, and rejects invalid status values. <!--hash:2c8e04b1-->
- `pr-status-api.integration.test.ts` — Integration stub tests for GET /api/v1/prs via harness: 200 with data, empty list, and 503 when no attempt store is configured. <!--hash:f16b9b52-->
- `raw-body.test.ts` — Unit tests verifying rawBody Buffer is populated for webhook paths and absent for non-webhook paths via the express.json verify hook. <!--hash:adb14b98-->
- `read-guard.test.ts` — Unit tests for createReadGuard middleware: loopback bypass, remote 403/401, bearer token, query-param token, and protected-path enumeration. <!--hash:ce1f8711-->
- `recovery-api.integration.test.ts` — Integration tests for GET /api/v1/recovery: returns full report when available, and empty default shape when no recovery has run. <!--hash:2deafad6-->
- `request-schemas.test.ts` — Unit tests for Zod request schemas: modelUpdateSchema, transitionSchema, steerSchema, and triggerSchema covering valid/invalid inputs and strict mode. <!--hash:fd7343c3-->
- `response-schemas-config.test.ts` — Unit tests for config-related Zod response schemas: configResponseSchema, overlay GET/PUT/PATCH, and put request body schema. <!--hash:e1a3e8fd-->
- `response-schemas-context.test.ts` — Unit tests for gitContextResponseSchema: valid parse, GitHub enrichment, active branches, and rejection of missing required fields. <!--hash:edb573e9-->
- `response-schemas-core.test.ts` — Unit tests for core HTTP response Zod schemas: refresh, abort, transition, error, runtime, recovery, attempts, state, observability, issue detail, and workspace inventory. <!--hash:bdaf576c-->
- `route-helpers.test.ts` — Unit tests for route helper utilities: issueNotFound, methodNotAllowed Allow header, sanitizeConfigValue redaction logic, and refreshReason header parsing. <!--hash:3bf3ad43-->
- `routes-extensions.test.ts` — Unit tests for registerExtensionRoutes: verifies it warns and skips each feature when its required dependency is absent. <!--hash:7a75d8f0-->
- `routes-system.test.ts` — Unit tests for registerSystemRoutes: asserts all system route paths are registered and events route is skipped with a warning when eventBus is absent. <!--hash:a8089852-->
- `routes-webhooks.test.ts` — Unit tests for registerWebhookRoutes: trigger route always registered, Linear/GitHub routes only registered when webhookHandlerDeps is present. <!--hash:b2da1945-->
- `routes.test.ts` — Integration and wiring tests for registerHttpRoutes: exercises all major routes end-to-end and verifies metrics/fallback/sub-router delegation. <!--hash:0def025a-->
- `secrets-api.integration.test.ts` — Integration tests for /api/v1/secrets CRUD routes: list, set, delete, key/value validation errors, and method guards using a real SecretsStore. <!--hash:d4d46b66-->
- `server-auth.test.ts` — Integration tests for HttpServer bind-time auth guard: refuses non-loopback bind without a read token, allows it when token is configured. <!--hash:8d2dfc32-->
- `server-branches.integration.test.ts` — Integration tests covering uncovered branches in server.ts, validation.ts, and route-helpers.ts via real HTTP and direct middleware invocation. <!--hash:48f81b11-->
- `server.test.ts` — End-to-end tests for HttpServer: API route ordering, 405 handling, secret redaction in config endpoint, and model selection validation. <!--hash:87557e7d-->
- `service-errors.test.ts` — Tests for serviceErrorHandler middleware: TypeError maps to 400, generic Error maps to 500, normal responses pass through. <!--hash:e6636544-->
- `setup-api.integration.test.ts` — Integration tests for /api/v1/setup/\* routes: master key, repo routes, Linear project, OpenAI key, and reset endpoints using real stores. <!--hash:e7709b1e-->
- `sse-contracts.integration.test.ts` — Integration tests for SSE /api/v1/events through the full HttpServer stack: all event types, concurrent clients, reconnect, and header validation. <!--hash:2e7f62c4-->
- `sse.test.ts` — Unit tests for the SSE handler: headers, initial connected frame, event forwarding, keep-alive, cleanup on disconnect, and idempotent teardown. <!--hash:aa10a008-->
- `swagger-html.test.ts` — Tests for getSwaggerHtml: returns valid HTML with Swagger UI CDN links, openapi.json reference, page metadata, and module-level caching. <!--hash:6fd62cfa-->
- `template-api.test.ts` — Tests for the prompt template HTTP API: rejects unsupported Liquid filters on POST and PUT. <!--hash:1a183341-->
- `template-override-handler.test.ts` — Unit tests for handleTemplateOverride and handleTemplateClear: 202/200 success, 404 for unknown template or issue, orchestrator delegation. <!--hash:95207d47-->
- `templates-api.integration.test.ts` — Integration tests for the full prompt template CRUD + preview API using a real SQLite store wired into the test harness. <!--hash:eb846c4c-->
- `transition-handler.test.ts` — Unit tests for handleTransition: not-found, invalid transition, custom and fallback state machine config, success, and tracker error paths. <!--hash:72c93fa7-->
- `transitions-api.test.ts` — Unit tests for handleGetTransitions: returns transition map from tracker states or stateMachine config; empty result when configStore absent. <!--hash:49366694-->
- `trigger-handler.test.ts` — Unit tests for handleTriggerDispatch: API key auth, re_poll/refresh_issue/create_issue actions, idempotency key dedup, and allowlist enforcement. <!--hash:bc29bd29-->
- `validation.test.ts` — Unit tests for validateBody, validateQuery, and validateParams middleware: valid inputs pass, invalid inputs return structured 400 errors. <!--hash:b826d8d3-->
- `webhook-404.test.ts` — Tests that unregistered /webhooks/\* paths return JSON 404 with correct content-type for both GET and POST methods. <!--hash:56561fb0-->
- `webhook-handler.test.ts` — Tests for verifyLinearSignature and handleWebhookLinear: HMAC validation, replay rejection, secret rotation, rate limiting, and event dispatch. <!--hash:1c1b9f6c-->
- `webhook-routes.test.ts` — Tests for registerWebhookRoutes: conditional route registration, POST-only enforcement, and trigger dispatch route availability. <!--hash:f2a85287-->
- `workflow-run-routes.test.ts` — Tests for Workflow Run HTTP support routes: list, detail, events, run-attempts endpoints using real artifacts; verifies no issue vocabulary leaks. <!--hash:960cc914-->
- `workspace-inventory.test.ts` — Tests for GET /api/v1/workspaces and DELETE /api/v1/workspaces/:key: classification, disk usage, sort order, lock semantics, and guard edge cases. <!--hash:621bd3ee-->
- `write-audit.test.ts` — Tests for WriteAuditLog: NDJSON append, lazy directory creation, multi-record append, field preservation, and newline compliance. <!--hash:2b0ee584-->
- `write-guard.test.ts` — Tests for createWriteGuard middleware: loopback/token auth rules, safe method passthrough, webhook path exemption, and audit log recording. <!--hash:8e5d62ca-->

## tests/integration/

- `config-workflow-expanded.integration.test.ts` — Expanded integration tests for config subsystem: API method guards, PUT/PATCH/DELETE overlay paths, DbConfigStore CRUD, coercion, and normalizer edge cases. <!--hash:b4e13b1c-->
- `config-workflow.integration.test.ts` — Integration tests for deriveServiceConfig: validates config derivation pipeline with tracker, codex, polling fields, defaults, and overlay merging. <!--hash:a3102404-->
- `docker-lifecycle.test.ts` — Placeholder Docker lifecycle tests gated behind DOCKER_TEST_ENABLED env var; verifies the skip guard functions correctly when unset. <!--hash:7272fa68-->
- `live.integration.test.ts` — Smoke test that verifies graceful skip when LINEAR_API_KEY is absent and the required MCP fixture can be copied to temp space. <!--hash:0b5b1bea-->
- `sqlite-runtime.integration.test.ts` — Integration tests for SQLite on-disk lifecycle: bootstrap idempotence, WAL mode, foreign keys, restart persistence, concurrent access, and error paths. <!--hash:0ded917d-->
- `sqlite-stores.integration.test.ts` — Integration tests for SqliteAttemptStore, IssueConfigStore, and SqliteWebhookInbox: CRUD, dedup, retry/DLQ, persistence, and cross-module FK enforcement. <!--hash:e15a4428-->

## tests/integration/live/

- `docker-live.integration.test.ts` — Live Docker smoke tests (opt-in via DOCKER_TEST_ENABLED=1): CLI availability, container run/cleanup, workspace mounts, and non-zero exit codes. <!--hash:74d0ca25-->
- `linear-live.integration.test.ts` — Live Linear API smoke tests (opt-in via LINEAR_API_KEY): auth, team listing, issue queries, cursor pagination, and full issue lifecycle. <!--hash:2eb9e0e6-->

## tests/linear/

- `board-columns.integration.test.ts` — Integration tests for buildWorkflowColumns: column ordering, issue placement into named and 'other' buckets, and cross-group deduplication. <!--hash:1f8f0762-->
- `board-columns.test.ts` — Unit tests for buildWorkflowColumns: column structure, kind/terminal flags, issue placement, deduplication, other bucket, and stateMachine config. <!--hash:3801becc-->
- `client.test.ts` — Unit tests for LinearClient: issue normalization, transport/HTTP/GraphQL error codes, pagination, fallback by state IDs, project/issue creation helpers. <!--hash:ccceefaf-->
- `errors.test.ts` — Unit tests for LinearClientError: code/message/name properties, Error inheritance, cause chaining, stack trace, and all error code variants. <!--hash:9db8ff9a-->
- `graphql-tool.test.ts` — Unit tests for handleLinearGraphqlToolCall: valid single operation, multi-operation rejection, and GraphQL errors mapped to success=false. <!--hash:20b223ee-->
- `issue-pagination.test.ts` — Unit tests for fetchCandidateIssues, fetchCandidateIssuesByStateIds, fetchIssueStatesByIds, and fetchIssuesByStates: pagination, variables, and error shapes. <!--hash:00be33bd-->
- `issue-parser.property.test.ts` — Property-based tests for normalizeIssue: never throws on arbitrary input, shape invariants, label lowercasing, identifier round-trip, and fallback defaults. <!--hash:a2429600-->
- `issue-parser.test.ts` — Unit tests for normalizeIssue: full issue normalization, label lowercasing/filtering, null/missing field fallbacks, priority coercion, and blocker logic. <!--hash:843a8fd3-->
- `linear-writeback.test.ts` — Unit tests for LinearClient state write-back: resolveStateId, updateIssueState (silent retries), updateIssueStateStrict (throws on failure), createComment. <!--hash:8ed152c1-->
- `nightly-failures.test.ts` — Tests for nightly CI failure tracking: fingerprinting, issue title/body generation, recurrence heuristics, create/update/auto-close Linear issue lifecycle. <!--hash:83630ecc-->
- `queries.test.ts` — Tests all Linear GraphQL query and mutation builder functions for correct structure, variables, and snapshot stability. <!--hash:6f5e9db7-->
- `tool-provider.test.ts` — Tests LinearTrackerToolProvider routing: exposes the linear_graphql tool name and delegates calls to the graphql tool handler. <!--hash:ce799056-->
- `transition-query.test.ts` — Tests buildIssueCommentMutation and buildIssueTransitionMutation for correct GraphQL structure and field declarations. <!--hash:544b9cbe-->
- `webhook-graphql.test.ts` — Tests LinearClient webhook CRUD operations (list, create, update, delete) including retry, error, and null-field edge cases. <!--hash:0bd5697b-->

## tests/linear/**snapshots**/

- `queries.test.ts.snap` — Vitest snapshot for buildCandidateIssuesByStateIdsQuery: captures expected GraphQL query string with project filter. <!--hash:bb58e1dc-->
- `transition-query.test.ts.snap` — Vitest snapshots for buildIssueCommentMutation and buildIssueTransitionMutation: expected Linear GraphQL mutation strings. <!--hash:32c7a7a1-->

## tests/live/

- `preflight-ci-contract.test.ts` — Contract test verifying the CI workflow's live-preflight job does not hardcode model config env vars, delegating to profile defaults. <!--hash:639a9b44-->
- `preflight-cli.test.ts` — Tests runLivePreflightCli: env file loading, output artifact writing, secret redaction, separator handling, and failure exit codes. <!--hash:84ebcfd1-->
- `preflight.test.ts` — Tests runLivePreflight: validates Linear, GitHub App, and model proxy checks, secret redaction, sandbox lifecycle, and failure reporting. <!--hash:43cac78a-->

## tests/notification/

- `channel.test.ts` — Tests shouldDeliverByVerbosity and shouldDeliverByMinSeverity filter functions for notification event delivery decisions. <!--hash:8d0b282c-->
- `desktop.test.ts` — Tests DesktopNotificationChannel dispatching to notify-send, osascript, and powershell per platform, with minSeverity filtering. <!--hash:14c9fb05-->
- `manager.test.ts` — Tests NotificationManager: fan-out delivery, deduplication, channel registration, persistence, event bus emissions, and failure isolation. <!--hash:99445191-->
- `notification-center.test.ts` — Tests NotificationCenter: list notifications, mark read, list alert history, and send Slack test with error mapping. <!--hash:cc080246-->
- `slack-webhook.integration.test.ts` — Integration tests for SlackWebhookChannel posting to a real local HTTP server with verbosity, payload structure, and error handling. <!--hash:88c52674-->
- `slack-webhook.test.ts` — Unit tests for SlackWebhookChannel verbosity filtering, block payload structure, and non-success webhook response errors. <!--hash:896b9c71-->
- `webhook-channel.test.ts` — Tests WebhookChannel posting generic JSON payloads, minSeverity filtering, and throwing on non-2xx responses. <!--hash:30a5f109-->
- `webhook-delivery.test.ts` — Tests deliverWebhookJson: POST payload construction, custom headers, status error labeling, timeout abort, and failure logging. <!--hash:d0cf337f-->

## tests/observability/

- `hub.test.ts` — Tests ObservabilityHub: component snapshot persistence, aggregation, and pruning of snapshots from dead processes. <!--hash:6c7b5fd4-->
- `metrics.test.ts` — Tests MetricsCollector counter and histogram serialization, label formatting, bucket accuracy, and constant memory behavior. <!--hash:c4aa686d-->
- `tracing.test.ts` — Tests tracingMiddleware: UUID generation, incoming X-Request-ID propagation, and getRequestId fallback for raw requests. <!--hash:2ef8a82d-->

## tests/orchestrator/

- `adaptive-polling.test.ts` — Tests orchestrator adaptive polling interval logic based on webhook health status and requestRefresh behavior with a connected tracker. <!--hash:d72785af-->
- `dirty-tracking-invariants.test.ts` — Safety-net tests verifying that orchestrator state mutations (running, retrying, claimed, overrides) correctly invalidate the snapshot cache. <!--hash:22ee5569-->
- `dispatch.test.ts` — Tests sortIssuesForDispatch priority/createdAt/identifier ordering and isBlockedByNonTerminal blocker detection logic. <!--hash:5a86d38b-->
- `git-post-run.test.ts` — Tests executeGitPostRun: commit, push, PR creation, PR summary generation, auto-merge policy evaluation, and error propagation. <!--hash:0b633d62-->
- `issue-locator.test.ts` — Tests resolveIssue priority ordering across running/retry/completed/detail state maps and toIssueView view projection. <!--hash:533f7c9d-->
- `issue-test-factories.ts` — Shared factory functions for orchestrator tests: creates typed Issue, Workspace, ModelSelection, RunningEntry, RetryEntry, and view fixtures. <!--hash:93f11cea-->
- `lifecycle-core.test.ts` — Tests lifecycle-state helpers: running entry reconciliation plans, queue/detail view projection, and completed claim seeding from attempts. <!--hash:fc27a52c-->
- `lifecycle-events.test.ts` — Tests createLifecycleEvent field defaults and toErrorString coercion for various value types. <!--hash:8eb72ca0-->
- `lifecycle.test.ts` — Tests reconcileRunningAndRetrying, refreshQueueViews, cleanupTerminalIssueWorkspaces, and seedCompletedClaims lifecycle functions. <!--hash:d1da6714-->
- `model-selection.test.ts` — Tests resolveModelSelection override lookup and updateIssueModelSelection persistence, events, and appliesNextAttempt flag logic. <!--hash:93a350ff-->
- `orchestrator-advanced.test.ts` — Advanced orchestrator integration tests: inactive issues, stale entry cleanup, retry startup failures, terminal cleanup, and git post-processing. <!--hash:cb129f7f-->
- `orchestrator-config-refresh.test.ts` — Tests that orchestrator invalidates cached workflow columns when the configStore stateMachine changes via subscription. <!--hash:bbc164a3-->
- `orchestrator-delegates.test.ts` — Tests RunLifecycleCoordinator context delegates: pushEvent, applyUsageEvent, notify, setQueuedViews, setRateLimits, and eventBus routing. <!--hash:2db5585e-->
- `orchestrator-fixtures.ts` — Shared test fixtures for orchestrator tests: typed factory functions for config, config store, attempt store, and passThroughWithLock. <!--hash:65f34399-->
- `orchestrator.test.ts` — Core Orchestrator integration tests: dispatch priority, retry queuing, per-state concurrency, workflow columns, abort, and model update. <!--hash:01f79f57-->
- `recovery.test.ts` — Tests runStartupRecovery: resuming viable attempts, cleaning up unrecoverable ones, and escalating attempts without a thread ID. <!--hash:7e00dae6-->
- `restart-recovery.integration.test.ts` — Integration tests for webhook dedup, restart persistence, abort race conditions, refresh coalescing, and SQLite bootstrap idempotence. <!--hash:e9646246-->
- `retry-coordinator.property.test.ts` — Property-based tests for computeBackoffForAttempt (bounds, monotonicity) and RetryCoordinator queue and cancel invariants. <!--hash:d259edca-->
- `retry-coordinator.test.ts` — Tests RetryCoordinator dispatch strategies: continuation, model override, exponential backoff, rate limiting, and timer-driven relaunch. <!--hash:1ff9cff0-->
- `retry-policy.test.ts` — Tests classifyRetryStrategy mapping error info types to retry actions: compact, timed retry, hard fail, and default fallback. <!--hash:1b30c903-->
- `run-lifecycle-coordinator.test.ts` — Tests RunLifecycleCoordinator full launch-retry-relaunch cycle and snapshot/detail read-model projections including attempt enrichment. <!--hash:1ec7a948-->
- `snapshot-builder.test.ts` — Tests snapshot-builder functions: runtime read model, attempt detail with app-server introspection, running/retry views, cost, and duration. <!--hash:38fab22a-->
- `snapshot-projection.test.ts` — Tests for snapshot projection helpers; verifies running, retry, outcome, and sorted completed issue views. <!--hash:7a28d16f-->
- `snapshot-serialization.test.ts` — Tests for serializeSnapshot; verifies camelCase-to-snake_case conversion and optional field fallbacks in the runtime snapshot. <!--hash:9135b298-->
- `stall-detector.test.ts` — Tests for detectAndKillStalledWorkers; covers timeout boundary logic, abort signaling, event emission, and stall event capping at 100. <!--hash:f48af01b-->
- `views.test.ts` — Tests for orchestrator view helpers: isHardFailure classification, issueView field mapping, usageDelta computation, and nowIso format. <!--hash:9b10d83e-->
- `watchdog.test.ts` — Tests for Watchdog; verifies healthy/degraded/critical status transitions, interval re-check, stop idempotency, and buildHealthSnapshot shape. <!--hash:37fed75a-->
- `worker-failure.test.ts` — Tests for handleWorkerFailure; covers entry removal, claim release, event emission, TokenRefreshError code propagation, and flush/update fallback chains. <!--hash:4fc83e46-->
- `worker-launcher.test.ts` — Tests for canDispatchIssue, hasAvailableStateSlot, launchWorker, and launchAvailableWorkers; verifies dispatch eligibility and concurrency slot enforcement. <!--hash:7972e9c0-->
- `worker-outcome-completion-writeback.test.ts` — Tests for writeCompletionWriteback; verifies comment content (tokens, duration, PR URL) and Linear state transition behavior on completion. <!--hash:a5fcdab4-->
- `worker-outcome-invariants.test.ts` — Tests high-level invariants of handleWorkerOutcome: abort claim release, tracker fetch fallback, flush failure propagation, and DONE/BLOCKED claim stickiness. <!--hash:0ef98d98-->
- `worker-outcome-prepare.test.ts` — Tests for prepareWorkerOutcome; verifies flush ordering, running entry cleanup, tracker fetch, attempt persistence, and model selection resolution. <!--hash:4f4f4eb2-->
- `worker-outcome.test.ts` — Integration tests for handleWorkerOutcome end-to-end routing: service-stop, terminal state, hard failure, retry backoff, stop signal detection, and event bus emission. <!--hash:7a8346aa-->
- `write-linear-completion.test.ts` — Integration tests for writeLinearCompletion wired through handleWorkerOutcome; verifies state transition and comment posting for DONE and BLOCKED signals. <!--hash:54ed4b35-->

## tests/persistence/

- `attempt-checkpoints.test.ts` — Tests for attempt checkpoint history: ordinal assignment, deduplication, listCheckpoints ordering, and the GET checkpoints HTTP endpoint. <!--hash:2a7e96a6-->
- `attempt-store-contract.test.ts` — Registers the shared AttemptStorePort contract suite against the SQLite adapter to verify behavioral conformance. <!--hash:ead9c877-->
- `attempt-store-contract.ts` — Shared contract test suite for AttemptStorePort; any adapter must pass this to prove CRUD, event, and aggregate conformance. <!--hash:94f4f85b-->
- `cost-sample-store.test.ts` — Tests for SqliteCostSampleStore: append/read ordering, null round-trip, limit/sinceMs filtering, retention truncation, and limit clamping. <!--hash:2c953a19-->
- `health-probe-store.test.ts` — Tests for SqliteHealthProbeStore: append/read ordering, probe/subprobe/sinceMs filtering, limit clamping, retention truncation, and empty subprobe no-op. <!--hash:c106c952-->

## tests/persistence/sqlite/

- `attempt-store-sqlite.test.ts` — Tests for SqliteAttemptStore: full CRUD, event ordering, token aggregates, checkpoint deduplication, PR upsert, and JSONL migration via PersistenceRuntime. <!--hash:f33dd596-->
- `automation-store.test.ts` — Tests for AutomationStore: run creation with newest-first listing, and finishRun updating status, output, and issue linkage in SQLite. <!--hash:29d143d4-->
- `database.test.ts` — Tests for openDatabase: table creation, WAL mode, foreign keys, in-memory support, data persistence across reopen, and closeDatabase behavior. <!--hash:ed99ddb7-->
- `issue-config-store.test.ts` — Tests for IssueConfigStore: loadAll, upsertModel, upsertTemplateId, clearTemplateId, and factory method — all against an in-memory SQLite DB. <!--hash:ff467243-->
- `mappers.test.ts` — Tests for SQLite row mappers: AttemptRecord and AttemptEvent round-trips, token usage flattening/reconstruction, enum coercion, and checkpoint mapper. <!--hash:5e429a64-->
- `migrator.test.ts` — Tests for migrateFromJsonl: empty/missing directories, valid attempt and event import, corrupt file skipping, and idempotency via ON CONFLICT DO NOTHING. <!--hash:f65175f7-->
- `notification-store.test.ts` — Tests for NotificationStore: create, newest-first listing, delivery summary update, markRead, and markAllRead against a SQLite-backed store. <!--hash:c52e6fd9-->
- `runtime.test.ts` — Tests for seedDefaults and initPersistenceRuntime: default template seeding, SQLite runtime construction, and webhook inbox surface exposure. <!--hash:3d543b27-->
- `schema-v2.test.ts` — Tests that openDatabase creates all Phase 1 tables, applies schema migrations up to at least v8, and sets correct SQLite pragmas. <!--hash:b4b06a6c-->
- `schema.test.ts` — Tests Drizzle schema definitions for all persistence tables: column presence, types, nullability, primary keys, and foreign keys. <!--hash:743dec6e-->
- `webhook-inbox.test.ts` — Tests for SqliteWebhookInbox: deduplication, status transitions, retry/dead-letter scheduling, stats, recent delivery listing, and error handling. <!--hash:9a560f3e-->

## tests/prompt/

- `store.test.ts` — Tests for PromptTemplateStore: CRUD operations, Liquid filter validation on create/update, and preview rendering with sample data. <!--hash:87acf12d-->

## tests/scripts/

- `quarantine.test.ts` — Tests for quarantine CLI scripts: addEntry, removeEntry, listEntries, loadEntries, healQuarantine pass/fail/threshold/stale logic, and runCli help text. <!--hash:2beafb78-->

## tests/secrets/

- `api.test.ts` — Integration tests for registerSecretsApi: list/set/delete secret keys via HTTP and error responses for invalid keys, values, and method mismatches. <!--hash:71f32845-->
- `db-store.test.ts` — Tests for DbSecretsStore: set/get/delete/list, encryption key mismatch, persistence across instances, subscribe/unsubscribe, and initialization guards. <!--hash:74bfe064-->
- `store.test.ts` — Tests for SecretsStore: encryption at rest, audit log, MASTER_KEY requirement, and wrong-key protection against overwriting encrypted data. <!--hash:db3c30f6-->

## tests/setup/

- `api-auth.test.ts` — Tests for setup API auth routes: PKCE flow start/status, GitHub token validation and storage, and method-not-allowed coverage across all setup endpoints. <!--hash:8237865a-->
- `api.test.ts` — Tests for registerSetupApi: status reporting, reset, master key creation, Linear project listing/selection, OpenAI key validation, and Codex auth storage. <!--hash:a91a1837-->
- `codex-auth-handler.test.ts` — Tests for the POST /api/v1/setup/codex-auth handler: auth JSON normalization, mkdir/writeFile side-effects, config overlay update, and error paths. <!--hash:dfe78bdb-->
- `detect-default-branch.test.ts` — Tests for detect-default-branch helpers and handler: URL parsing, token resolution priority, auth/fallback fetch logic, and invalid URL rejection. <!--hash:b8ec06a8-->
- `device-auth.test.ts` — Tests for PKCE auth helpers: createPkceSession URL shape, exchangePkceCode token exchange, and savePkceAuthTokens file write and overlay update. <!--hash:ecc552f3-->
- `github-token-handler.test.ts` — Tests for POST /api/v1/setup/github-token: token validation against GitHub API, storage on success, and rejection for missing/invalid/network-failure cases. <!--hash:c03969c6-->
- `handlers.integration.test.ts` — Integration tests for setup handler functions using real filesystem, SecretsStore, and ConfigOverlayStore — covers master key, reset, and status handlers. <!--hash:f9de6143-->
- `label-handler.test.ts` — Tests POST /api/v1/setup/create-label: auth guard, success, duplicate detection, and Linear network error cases. <!--hash:61532de7-->
- `linear-project-handler.test.ts` — Tests GET linear-projects listing and POST linear-project selection endpoints: auth, error, and orchestrator-trigger cases. <!--hash:4e46d3e4-->
- `master-key-handler.test.ts` — Tests handlePostMasterKey: key generation, custom key, already-initialized guard, and filesystem failure cases. <!--hash:d48e29e8-->
- `openai-key-handler.test.ts` — Tests POST /api/v1/setup/openai-key: validates and stores direct OpenAI or proxy-provider keys, handles invalid/rejected keys. <!--hash:e3ec363c-->
- `pkce-auth-handler.test.ts` — Tests PKCE OAuth flow endpoints (start, status, cancel): session lifecycle, token exchange, timeout, and error paths. <!--hash:779593f8-->
- `project-handler-extended.test.ts` — Extended tests for POST /api/v1/setup/create-project: name validation, team lookup, project creation, and fallback team-key cases. <!--hash:3475a5a8-->
- `project-handler.test.ts` — Tests POST /api/v1/setup/create-project: Linear API key guard, name validation, teams lookup, and success/failure paths. <!--hash:f208b83c-->
- `quick-start.test.ts` — Tests quick-start helpers create-test-issue and create-label: auth guards, Linear API error cases, and success responses. <!--hash:06382ce1-->
- `reconfigure-flow.test.ts` — Integration flow tests: reset clears master key so a subsequent setup run can generate a fresh one; Codex auth state after reset. <!--hash:b84f1ae0-->
- `repo-route-handlers.test.ts` — Tests GET/POST/DELETE repo-route endpoints: empty routes, save, replace by prefix, URL validation, index-based deletion. <!--hash:5aa92065-->
- `reset-handler.test.ts` — Tests handlePostReset: stops orchestrator, deletes secrets, clears config and master key, error handling and ordering. <!--hash:c3f45c60-->
- `setup-fixtures.ts` — Shared test harness for setup API tests: mock factories, Express server launcher, fetch interceptor, and lifecycle hooks. <!--hash:826c08c7-->
- `setup-port.test.ts` — Integration tests for setup service: project discovery, test-issue/label provisioning via tracker boundary, github-kind status. <!--hash:d500ff53-->
- `setup-service.test.ts` — Integration tests for createSetupService: full setup flow, reset, repo route management, and default-branch detection. <!--hash:4b0eed8c-->
- `setup-status.integration.test.ts` — Integration tests for setup-status helpers using real filesystem and SecretsStore: auth file detection, Linear credentials, slug reading. <!--hash:e04072fb-->
- `setup-status.test.ts` — Unit tests for setup-status helpers: overlay key resolution (flat vs nested), own-property defense, Codex auth, Linear credentials. <!--hash:51dc1b48-->
- `status-handler.test.ts` — Tests handleGetStatus: maps each setup step (masterKey, linearProject, openaiKey, githubToken, repoRoute) to done/not-done. <!--hash:e6ecc1f1-->
- `test-issue-handler.test.ts` — Tests POST /api/v1/setup/create-test-issue: auth guard, project/team/state lookup, issue creation, and error paths. <!--hash:2169fecd-->

## tests/state/

- `defaults.test.ts` — Verifies DEFAULT_ACTIVE_STATES and DEFAULT_TERMINAL_STATES export the correct values from state/defaults. <!--hash:8640987d-->
- `machine-properties.test.ts` — Property-based tests for StateMachine: self-transition validity, normalization idempotency, terminal constraints, stage deduplication. <!--hash:f6ae3b26-->
- `machine.integration.test.ts` — Integration tests for StateMachine: default states, case-insensitivity, getStages, canTransition (default and explicit), assertTransition. <!--hash:93dab2e2-->
- `machine.property.test.ts` — Property-based tests for StateMachine invariants: self-transition, normalization, terminal lock-out, stage uniqueness. <!--hash:2e577a0d-->
- `machine.test.ts` — Unit tests for StateMachine: default stages, explicit transitions, terminal blocks, assertion errors, degenerate configs. <!--hash:02e7bcdf-->
- `policy.test.ts` — Tests state policy helpers: isActiveState, isTerminalState, isGateState, isTodoState, listWorkflowStages, getStateMachine caching. <!--hash:74d436aa-->
- `state-policy.integration.test.ts` — Integration tests for state/policy.ts: tracker-based and stateMachine-based configs, normalization, WeakMap caching correctness. <!--hash:85feca19-->

## tests/tracker/

- `factory.test.ts` — Tests createTracker factory: returns LinearTrackerAdapter and LinearClient, creates scoped logger, delegates fetchCandidateIssues. <!--hash:d96ff8f7-->
- `github-adapter.test.ts` — Tests GitHubTrackerAdapter: issue fetching, state normalization, transitions (close/reopen), comment, createIssue, provision. <!--hash:026cb777-->
- `linear-adapter.test.ts` — Tests LinearTrackerAdapter: delegation to LinearClient for all tracker port methods and provision operations. <!--hash:dacb773e-->

## tests/utils/

- `retry.test.ts` — Tests withRetry and withRetryReturn: immediate success, retry on transient failure, max-attempts exhaustion, re-throw behavior. <!--hash:94d870cc-->
- `tool-call-result.test.ts` — Tests toolCallSuccess, toolCallFailure, and toolCallErrorPayload: JSON serialization and success/failure flag correctness. <!--hash:e5701b02-->
- `type-guards.integration.test.ts` — Integration tests for type-guard helpers: isRecord, asRecord, asArray, asStringOrNull, asBooleanOrNull, asStringRecord, getErrorMessage. <!--hash:3ac2d803-->
- `type-guards.test.ts` — Unit tests for type-guard utility functions: record detection, safe coercions to array/string/boolean/record, error message extraction. <!--hash:474ee0e0-->

## tests/webhook/

- `delivery-workflow.test.ts` — Tests WebhookDeliveryWorkflow: new vs duplicate delivery handling, no-store passthrough, and 503 on inbox insert failure. <!--hash:518b10ba-->
- `health-tracker.test.ts` — Tests DefaultWebhookHealthTracker: disconnected/connected/degraded state machine, cooldown, periodic checks, event emission, stop lifecycle. <!--hash:314d8f66-->
- `manual-mode.test.ts` — Tests evaluateWebhookConfig and webhook config derivation: secret presence/absence, empty URL, and config pipeline integration. <!--hash:515a416e-->
- `registrar.test.ts` — Tests WebhookRegistrar: manual-secret, stored-secret, auto-create strategies, re-enable disabled webhooks, permission errors. <!--hash:7aae5c1f-->
- `runtime.test.ts` — Tests createWebhookRuntime: no-op when URL absent, secret sync via registrar, and unified persistence+health snapshot. <!--hash:9713f61c-->
- `services-wiring.test.ts` — Tests WebhookRegistrar wiring: onSecretResolved closure updates getWebhookSecret, stop idempotency, no-op without config. <!--hash:056a80ea-->

## tests/workflow-run/

- `linear-intake.test.ts` — Tests acceptLinearTriggeredWorkflowRun: persists WorkflowRun artifact (metadata.json + events.jsonl) from a Linear issue trigger. <!--hash:c7d2403d-->

## tests/workspace/

- `manager.integration.test.ts` — Integration tests for WorkspaceManager: directory creation, hook execution with env vars, pruning, timeouts, worktree fallback to rm. <!--hash:17b68a63-->
- `manager.test.ts` — Unit tests for WorkspaceManager; covers directory and worktree strategies, creation, removal, dirty-state rescue, and path sanitization. <!--hash:0d6d2077-->
- `path-registry.test.ts` — Unit tests for PathRegistry; validates container-to-host prefix translation, longest-match selection, env-var init, and trailing-slash normalization. <!--hash:030c1fea-->
- `paths.property.test.ts` — Property-based tests for workspace path utilities; verifies sanitizeIdentifier, isWithinRoot, and resolveWorkspacePath against arbitrary inputs via fast-check. <!--hash:5bfe9fb2-->
- `paths.test.ts` — Unit tests for workspace path utilities; covers sanitizeIdentifier edge cases, isWithinRoot boundary conditions, and resolveWorkspacePath traversal safety. <!--hash:2b861212-->
- `safe-path.test.ts` — Unit tests for buildSafePath; verifies that only well-known system directories are retained from PATH and a safe fallback is returned when PATH is absent. <!--hash:70224db5-->
