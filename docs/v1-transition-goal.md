# Risoluto v1 Transition Goal

This file merges the Step 1-4 prompts/logs and the transition handoff into one Codex-ready execution artifact. Use it as the current source of truth for continuing the v1 foundation work.

## Goal

Reach a coherent `1.0.0` Foundation Baseline for `risolutohq/risoluto`: clean repo identity, backend-first runnable source, current docs, meaningful tests, green CI, and no stale frontend/docs-site/product-roadmap assumptions.

## Source Files Merged

- Step 1 GitHub org/repo setup prompt and execution log.
- Step 2 pre-v1 repo transition prompt and execution log.
- Step 3 foundation docs completion log.
- Step 4 curated snapshot import completion log.
- Ordered transition agent handoff.

## Confirmed Decisions

- Product name: Risoluto.
- Canonical public repo: `risolutohq/risoluto`.
- Pre-v1 repository is preserved outside the canonical repo as read-only history.
- Default branch: `master`.
- Version path: `0.1.0` starts the transition; `1.0.0` means Foundation Baseline.
- Roadmap model: living capability backlog after v1, not preplanned v2/v3/v4.
- Planning tracker: Linear canonical; GitHub Issues public intake/mirror.
- Product primitive: Workflow Run.
- Primary surface: CLI.
- Next first-class surface: TUI.
- Support/internal surface: HTTP API.
- Excluded for now: web frontend and docs-site.

## Step Status

| Step                                | Status   | Proof                                                                                                                                             |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. GitHub org and repo setup        | done     | `risolutohq/risoluto` exists, public, default branch `master`.                                                                                    |
| 2. Preserve pre-v1 repo separately  | done     | Pre-v1 repository was renamed, marked as historical, and archived outside this repo.                                                              |
| 3. Foundation docs scaffold         | done     | Product spine, technical spine, decision register, six ADRs, backlog, research workflow, testing strategy, and release rules exist under `docs/`. |
| 4. Curated snapshot import          | done     | Backend/app source exists in clean canonical history with `v0.1.0` tag.                                                                           |
| 5. Planning docs current-truth pass | partial  | Docs exist and were refreshed; they still need release-by-release upkeep.                                                                         |
| 6. Workflow Run reshape             | not done | Source still contains issue-centric API names and persistence concepts.                                                                           |
| 7. CI/test/release rebuild          | partial  | Backend-only CI exists; live PR resources and release qualification are not fully wired.                                                          |
| 8. `1.0.0` Foundation Baseline      | not done | Blocked by Workflow Run reshape, live checks, and final release qualification.                                                                    |

## Done

1. GitHub org `risolutohq` exists and Omer controls it as admin.
2. Public canonical repo `risolutohq/risoluto` exists.
3. Pre-v1 repository was preserved separately and made non-canonical.
4. Canonical repo started from clean history.
5. Foundation docs exist under `docs/`.
6. Six foundational ADRs exist.
7. The curated backend/app snapshot is in the canonical repo.
8. `v0.1.0` exists as the transition baseline tag.
9. `src/workflow/columns.ts` was moved under the Linear boundary as `src/linear/board-columns.ts`.
10. Anvil, old agent-local folders, old docs, web frontend, docs-site, generated reports, runtime logs, and private research contents are absent from the repo.

## Newly Completed In This Cleanup Pass

1. Root repo identity was reset with fresh `README.md`, `AGENTS.md`, and `CHANGELOG.md`.
2. `package.json` now points at `risolutohq/risoluto`.
3. Backend-only scripts replaced frontend/docs-site/browser test scripts.
4. Frontend-only dependencies were removed.
5. Relevant Dependabot dependency updates were applied directly.
6. CI was rebuilt around backend build, lint, format, typecheck, unit tests, integration tests, live smoke, Docker build, gitleaks, and dependency review.
7. HTTP route fallback is API-first JSON 404, not a static web app fallback.
8. The docs-site OpenAPI sync test was removed; runtime OpenAPI tests remain.
9. Import manifest content was merged here and removed from the repo root.

## Not Done

1. Workflow Run has not fully replaced Issue in source, API names, persistence, or tests.
2. Tracker adapter contracts are not yet fully generalized across Linear, GitHub, GitLab, Jira, and future trackers.
3. Attempt Memory, Run Memory, Project Memory, Memory Builder, and Memory Manager are spine concepts, not complete implementation.
4. Built-in TypeScript Workflow Definitions are not yet the core execution model.
5. Hooks, gates, transitions, role execution artifacts, and event-sourced run log need implementation hardening.
6. TUI is not implemented.
7. Mandatory live PR checks are not fully wired to dedicated sandbox resources.
8. Release automation and `1.0.0` qualification gates need final hardening after the foundation reshape.

## Current Blockers

- The implementation still contains issue-centric names because the copied backend source predates the Workflow Run model.
- Live tests require configured sandbox Linear/GitHub/model credentials.
- `typecheck:tests` remains available as a local debt scanner until the remaining copied test typing debt is removed, but it is not a CI gate.

## Current Test Surface Without Frontend

The frontend deletion does not leave the product untestable. It changes what counts as the functional surface:

1. **CLI tests** cover the primary operator surface: startup, setup, config, command parsing, runtime boot, and smoke flows.
2. **HTTP API tests** cover the support/internal control surface: route contracts, webhook intake, state snapshots, workspace operations, notifications, Git/GitHub helpers, and error contracts.
3. **Unit tests** cover deterministic core behavior: parsers, config normalizers, state machinery, orchestrator helpers, persistence mappers, signal detection, and policy functions.
4. **Integration tests** cover subsystem wiring: SQLite persistence, HTTP contracts, setup workflows, restart recovery, Docker lifecycle, and tracker intake semantics.
5. **Live smoke tests** cover real external behavior when credentials exist: Linear/GitHub/model-provider paths through sandbox resources.
6. **Load tests** cover backend performance envelopes without browser UI.
7. **Future TUI tests** should use terminal-level rendering and interaction tests once the TUI exists.

## Next Codex Goal

Use this prompt next:

```text
Use GPT-5.5 with reasoning.effort=xhigh and text.verbosity=medium.

You are continuing the Risoluto v1 foundation transition in /home/oruc/Desktop/workspace/risoluto-v1.

Read:
- docs/v1-transition-goal.md
- docs/product-spine.md
- docs/technical-spine.md
- docs/decisions.md
- docs/adr/0001-workflow-run-as-core-primitive.md
- docs/testing-strategy.md
- docs/release-rules.md

Goal: perform the first Workflow Run reshape slice without broad rewrites.

Scope:
- Identify the smallest issue-centric source/test slice that blocks the Workflow Run model.
- Prefer renaming or adapter-boundary tightening only when behavior stays unchanged.
- Keep CLI primary, TUI future, HTTP API support/internal.
- Do not add frontend or docs-site files.
- Do not create Linear/GitHub issues in this run.

Required output:
- One narrow code/doc change.
- Tests updated for the changed behavior.
- Verification commands run.
- A commit if checks pass.

Definition of done:
- The slice reduces issue-as-core coupling.
- No stale frontend/docs-site/product-roadmap references are introduced.
- Build, lint, format check, unit tests, and typecheck are reported.

Working-memory rule:
- Keep docs/v1-transition-goal.md current if the slice changes what is done, blocked, or intentionally deferred.
- Add an ADR only for a hard-to-reverse decision; otherwise update docs/decisions.md.

Verification loop:
- Fast loop while editing: `pnpm run build` plus the focused tests you touched.
- Final loop before commit: `pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck`.
```
