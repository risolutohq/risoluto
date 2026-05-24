# v0.1.0 Curated Snapshot Import Manifest

> Single-commit curated import from `OmerFarukOruc/risoluto-legacy` (archived 2026-05-24).
> **Snapshot only** — no git history grafted, no copy of `.git/` directory.
> Classified per [`docs/technical-spine.md`](./docs/technical-spine.md) into: **core / adapter / runtime / interface / observability / quarantine / delete**.
> This file lives at the repo root (not under `docs/`) because it documents the snapshot itself, not the v1 spine. It can be deleted once Step 6 reshape is complete.

---

## Source / Destination / Method

- **Source:** `/home/oruc/Desktop/workspace/risoluto` — legacy clone (now archived at `OmerFarukOruc/risoluto-legacy`)
- **Destination:** `/home/oruc/Desktop/workspace/risoluto-v1` — fresh clone of `risolutohq/risoluto`
- **Method:** `rsync -a` with explicit `--exclude` patterns, followed by targeted post-rsync cleanup of hidden directories and leftover symlinks

## Classification Summary

| Bucket | `src/*` subdirs | Notes |
|---|---|---|
| **core** | `state` | Generic state machine; survives intact |
| **adapter** | `agent`, `codex`, `git`, `github`, `tracker` | Tracker / Harness / PR adapter implementations |
| **runtime** | `docker`, `secrets`, `utils`, `workspace` | Execution-plane infrastructure + Dockerfiles + `.husky/` |
| **interface** | `cli`, `setup`, `webhook` | Operator surfaces + `bin/` |
| **observability** | `alerts`, `audit`, `health`, `notification`, `observability` | Spine-agnostic instrumentation |
| **quarantine** | `agent-runner`, `automation`, `config`, `core`, `dispatch`, `http`, `linear`, `orchestrator`, `persistence`, `prompt`, `workflow` | Issue-keyed today; reshape under Workflow Run primitive in Step 6 per ADR-0001 |

`tests/` mirrors `src/` layout minus frontend/e2e. Spine-agnostic test suites (`tests/state/`, `tests/utils/`, `tests/agent/`, `tests/audit/`, etc.) survive intact; issue-coupled suites (`tests/orchestrator/`, `tests/persistence/`, `tests/http/`, `tests/config/`, `tests/integration/`) live in quarantine alongside their source.

See [`quarantine.json`](./quarantine.json) for the machine-readable list.

## Excluded (delete)

| Category | Items |
|---|---|
| Frontend & UI | `frontend/`, `vitest.frontend.config.ts`, `playwright.config.ts`, `playwright.fullstack.config.ts`, `tsconfig.e2e.json`, `tests/frontend/`, `tests/e2e/`, `tests/e2e-lib/` |
| Generated artifacts | `dist/`, `node_modules/`, `.cache/`, `playwright-report/`, `test-results/`, `reports/`, `.stryker-tmp/`, `risoluto-logs/` (also: top-level `risoluto-logs` shell script — operator skill artifact) |
| Legacy docs | `docs-site/`, `design-handoff/`, `risoluto-architecture.html`, `PRODUCT.md`, `DESIGN.md`, `README.md` (Step 2 banner version), `docs/strategy/`, `docs/ROADMAP_AND_STATUS.md`, `docs/CONFORMANCE_AUDIT.md`, `docs/OPERATOR_GUIDE.md`, `docs/guides/`, `docs/GETTING_STARTED.md`, `docs/TRUST_AND_AUTH.md`, `docs/ARCHITECTURE_DEEPENING_EXECPLAN.md`, `docs/reference/`, `docs/archive/`, `docs/ARCHITECTURE_*`, etc. |
| Legacy agent / tooling state | `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.anvil/`, `.claude/`, `.codex/`, `.impeccable.md`, `.expect/`, `.superset/`, `.mcp.json`, `opencode.json`, `agent-browser.json`, `skills/` (operator-local symlink), `.agents/archive/`, `.agents/prompts/`, `.agents/workflows/`, `.agents/skills` |
| Private intel | `research/` (private submodule — no `src/` references; safe to exclude) |
| Browser/E2E scripts | `scripts/autopilot.sh`, `scripts/run-e2e.sh`, `scripts/e2e-config.*.yaml`, `scripts/e2e-lib/`, `scripts/e2e-lifecycle.ts` |
| Safety patterns | `.env`, `.env.*`, `*.log`, `*.tsbuildinfo`, `*.pem`, `*.key` |

## Scripts Kept (selective)

`scripts/`: `backend-integration-coverage.mjs`, `mutate-changed.mjs`, `nightly-evidence-links.ts`, `nightly-failure-summary.ts`, `nightly-history-r2.ts`, `nightly-linear-intake.ts`, `nightly-validation-fail.ts`, `quarantine-heal.ts`, `quarantine-shared.ts`, `quarantine.ts`, `sync-labels.sh`, `upload-nightly-artifacts-r2.ts`, `.pipeline/`. Nightly scripts are quarantined pending Step 7 CI rebuild.

## Borderline Decisions Made (B1–B9 + import-time discoveries)

| # | Decision | Outcome |
|---|---|---|
| B1 | Rename issue-centric files at import? | **No** — keep names through `0.x`; rename + types together in Step 6 |
| B2 | Prune frontend deps from `package.json`? | **Revised: import as-is.** Pruning requires regenerating `pnpm-lock.yaml` — multi-step, deferred to Step 6/7 |
| B3 | Keep `anvil.config.yaml`? | **Reversed (2026-05-24, post-v0.1.0):** Anvil deleted completely. Sequence: `26c374e` removed the config + quarantine entry, `db14986` cleaned `.gitignore`, `c6af408` scrubbed the `ANVIL_BACKEND_PORT` env-var fallback in `src/cli/parse-args.ts` plus cosmetic "anvil hardening" text in `tests/cli/bootstrap.test.ts`. |
| B4 | Keep `opencode.json`, `agent-browser.json`? | **No** — both deleted |
| B5 | `.agents/` contents? | **Reversed (2026-05-24, post-v0.1.0):** entire `.agents/` directory removed. Originally kept `PLANS.md` as ExecPlan template; operator deleted it manually because the legacy template encodes the old framing and v1 will introduce its own planning artifacts under the new spine. |
| B6 | `scripts/`? | **Selective** — see list above |
| B7 | `docs/archive/`? | **Drop** |
| B8 | Top-level `skills/` symlink? | **Drop** (resolved by rsync to operator-local content; not project-canonical) |
| B9 | Move `src/workflow/columns.ts` → `src/linear/board-columns.ts`? | **Revised: leave in place.** Move + reference updates belong in one Step 6 commit |
| Import-time | `.anvil/`, `.claude/`, `.codex/`, `.impeccable.md`, `.expect/`, `.mcp.json`, `.stryker-tmp/`, `.superset/` discovered during cleanup | All dropped — legacy operator tooling state, not project-canonical |

## Pending Follow-ups (what blocks the snapshot from building)

This snapshot **does not build green** as-is. Per `0.x` allowances in the original handoff (Step 7: "Allow red/incomplete CI during `0.x`"), this is acceptable for the `0.1.0` baseline. The following must land before `1.0.0`:

1. **Prune frontend deps** from `package.json` + regenerate `pnpm-lock.yaml`. (Step 6/7)
2. **Update build/lint/test configs** to remove frontend references: `tsconfig.json`, `tsconfig.typecheck.json`, `tsconfig.eslint.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `vitest.live.config.ts`, `vitest.load.config.ts`, `eslint.config.js`, `knip.json`, `knip.config.ts`, `stryker.config.json`. (Step 6/7)
3. **Update `package.json` scripts** that reference frontend: `build:frontend`, `dev:frontend`, `test:frontend`, and the `build` script that chains to `build:frontend`. (Step 6/7)
4. **Move `src/workflow/columns.ts` → `src/linear/board-columns.ts`** + update references. (Step 6 — see B9)
5. **Rename issue-centric files** alongside Workflow Run primitive reshape: `src/orchestrator/issue-locator.ts` → `run-locator.ts`, `src/linear/issue-parser.ts` → `intake-parser.ts`, `src/linear/nightly-failures.ts` → `run-failure-summary.ts`, etc. (Step 6)
6. **Reshape quarantined modules** under Workflow Run primitive per ADR-0001: `src/orchestrator/`, `src/persistence/`, `src/http/`, `src/dispatch/`, `src/core/`, `src/agent-runner/`, `src/automation/`, `src/config/`, `src/prompt/`. (Step 6)
7. **Rewrite project-root meta files** fresh for v1: `README.md`, `CLAUDE.md`, `AGENTS.md`. (Step 6/7)
8. **Rebuild CI workflows** under `.github/workflows/` for the new spine. (Step 7)
9. **Fix `docs/release-rules.md`** — current text says "Build green" is required for `0.1.0`; the handoff explicitly allows red CI in `0.x`. One-line correction needed.

## How to Read This Snapshot

- **`src/state/` is the only `src/` subdir classified as `core`.** Everything else lives in `adapter`, `runtime`, `interface`, `observability`, or `quarantine`.
- **Quarantine ≠ delete.** Quarantined modules preserve implementation intelligence that Step 6 will reshape, not throw away. `src/orchestrator/` is the natural home of the Workflow Run engine once `Issue` becomes `WorkflowRun`.
- **Spine docs live at `docs/`** and predate this import (commit `09c27aa`). Nothing in this snapshot overwrote them.
- **`quarantine.json`** (at repo root) is the machine-readable quarantine ledger for tooling and future scripts.
