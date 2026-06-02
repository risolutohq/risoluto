# AGENTS.md

Working rules and context for any AI agent in this repo (Claude Code, Codex, etc.). `CLAUDE.md` is a one-line redirector that `@`-imports this file — edit here, never there. One source of truth, no symlink (works cross-platform).

## Identity

- The user's name is Omer.
- Act as a high-agency engineering partner: inspect the repo, make the smallest useful change, verify it, and leave clear evidence.

## Project Intent

Risoluto v1 is a clean foundation baseline for workflow-run-centered background agent orchestration. **Backend-first:** CLI is the primary surface, TUI is next, HTTP API is support/internal. **Do not** reintroduce web frontend, dashboard, docs-site, or legacy roadmap assumptions unless the active task explicitly rebuilds that surface. If a request implies one of these, surface the conflict before implementing.

## Prerequisite — `research/` submodule

The `research/` submodule (`risolutohq/risoluto-research`, private) is a hard prerequisite for **any** work in this repo. Before doing anything else, verify it is initialized:

```bash
git submodule status research
# leading space = initialized; leading "-" = run:
git submodule update --init research
```

The `skills/risoluto-features/` skill writes into this submodule and fails hard if it is missing. See the `/init-research` Claude Code skill for a one-shot init.

## Working Rules

- Use Node.js 22 or newer; package manager is pnpm 11.
- Prefer `rg` for exact search.
- Keep changes scoped to the request.
- Use `apply_patch` for manual edits (Codex) / the dedicated edit tools (Claude Code).
- Do not rewrite git history or force-push.
- Do not add frontend/docs-site assumptions unless the current task explicitly rebuilds those surfaces.
- Keep docs current or absent. A stale doc is worse than no doc.

## Verification gate (canonical order)

The pre-commit / pre-PR gate is:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck && pnpm run typecheck:coverage
```

Run the steps in that order — `build` first surfaces TS errors before lint waste, `format:check` is a fast read-only gate, `typecheck` runs `tsc --noEmit`, and `typecheck:coverage` (type-coverage >= 95%) is the final spend. The Claude Code `/v1-check` skill runs the same sequence and reports per-step status.

When changes touch integration boundaries, also run the relevant focused suite: `test:integration`, `test:integration:sqlite`, `test:integration:contracts`, `test:integration:live` (requires `.env.live.local`), `test:load`, or `test:docker`.

## Code-style ceilings (enforced by ESLint)

- `complexity`: **15** per function

Refactor before a function's branching would breach the complexity cap — splitting is cheaper than disabling the rule. Prettier config: 120-col, double quotes, 2-space indent, LF.

ESLint ignores `*.mjs`, so skill scripts (e.g. `research.mjs`, `synthesize.mjs`) are **not** subject to this ceiling — it applies to `.ts` files only.

## Test tiers (4 vitest configs)

- `vitest.config.ts` — default unit suite (`pnpm test`)
- `vitest.integration.config.ts` — `pnpm run test:integration*`
- `vitest.live.config.ts` — real external APIs (needs `.env.live.local`)
- `vitest.load.config.ts` — load / perf tier

Quarantined tests live in `quarantine.json` (currently empty). Do not silently add to it — quarantine is for flaky tests with an open ticket, not for ones an agent could not fix.

## Product Spine

The core primitive is `Workflow Run`, not tracker issue. Trackers are intake, mirror, and projection adapters. CLI is primary, TUI is next, HTTP API is support/internal, and web frontend is excluded for now.

## Commit / release flow

Conventional Commits enforced via `commitlint`. Husky pre-commit runs `gitleaks` (secret scan) + `lint-staged` (eslint --fix + prettier on staged `.ts` / `.json` / `.yml`). `semantic-release` (`.releaserc.yml`) handles changelog + git tagging from commit subjects — write subjects accordingly (`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `ci:` / `refactor:`).

## Living context (read on demand)

- `@docs/product-spine.md`, `@docs/technical-spine.md` — what v1 actually is
- `@docs/decisions.md`, `@docs/adr/` — decisions with rationale
- `@docs/testing-and-release.md` — test tiers, the `1.0.0` gate, and release flow
- `@docs/roadmap.md` — the single ordered plan of what's next
- `@docs/research-to-shipping-pipeline.md` — the planning pipeline: stage-by-stage how-to, file contracts, and ownership (decisions in `docs/adr/0001-foundation.md` §7, decisions.md row #29)
- `@skills/risoluto-features/SKILL.md` — two-repo spine updater (consumes `research/`)

(The `@path` prefix is Claude Code's inline-import syntax; other tools should read these as regular file references.)
