# PLAN

## Goal

Make `risoluto-v1` read as a clean backend-first v1 foundation while safely applying current dependency updates.

## Current Strategy

Manual `/goal` execution is active on `codex/v1-drift-deps-cleanup`.

Dependency branches were pruned from `origin`, so the strategy is:

1. Use GitHub PR metadata/diffs for the two deleted Dependabot branches.
2. Treat the named branches as superseded only after confirming current `master` already contains their listed package versions.
3. Apply only additional safe latest updates that are not already represented by the lockfile.
4. Keep stale-reference cleanup narrow and limited to current-surface conflicts.

Omer then widened the dependency instruction to update everything to latest, including Corepack. Final dependency strategy:

1. Pin latest pnpm via Corepack (`pnpm@11.3.0`).
2. Run a real `pnpm update --latest`.
3. Migrate pnpm settings from ignored `package.json#pnpm` to `pnpm-workspace.yaml`.
4. Keep TypeScript 6.0.3 despite peer metadata warnings from latest `madge` and `type-coverage`, because their actual repo commands pass.

## Phases

- [x] Orient on repo state, branch, remote, PRs, and transition docs.
- [x] Run required stale-reference searches and classify findings.
- [x] Remove or rewrite stale v1-conflicting assumptions.
- [x] Inspect the production and dev Dependabot branches.
- [x] Apply dependency updates in controlled batches.
- [x] Fix dependency update blockers.
- [x] Check GitHub Actions versions and CI assumptions.
- [x] Run final verification.
- [x] Commit, push, open PR, and check remote CI.

## Final State

- Branch: `codex/v1-drift-deps-cleanup`.
- PR: `https://github.com/risolutohq/risoluto/pull/3`.
- Dependency/update commit: `91b1f92 chore(deps): refresh v1 foundation dependencies`.
- Remote CI unblock commit: `2dcdc6a ci: keep dependency review non-blocking until graph is available`.
- Latest remote CI run checked: `26368524168`, completed successfully.
- Dependency Review remains visible in CI but non-blocking because GitHub reports Dependency Graph support unavailable for this repository; local `pnpm audit --prod` is clean.

## Open Decisions

- None currently blocking local verification.
