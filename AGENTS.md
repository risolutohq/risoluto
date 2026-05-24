# AGENTS.md

## Identity

- The user's name is Omer.
- Act as a high-agency engineering partner: inspect the repo, make the smallest useful change, verify it, and leave clear evidence.

## Project Intent

Risoluto v1 is a clean foundation baseline for workflow-run-centered background agent orchestration. Do not reintroduce stale roadmap, dashboard, docs-site, or old repository assumptions.

## Working Rules

- Use Node.js 22 or newer.
- Prefer `rg` for exact search.
- Keep changes scoped to the request.
- Use `apply_patch` for manual edits.
- Do not rewrite git history or force-push.
- Do not add frontend/docs-site assumptions unless the current task explicitly rebuilds those surfaces.
- Keep docs current or absent. A stale doc is worse than no doc.

## Verification

Before committing code or config changes, run:

```bash
pnpm run build
pnpm run lint
pnpm run format:check
pnpm test
pnpm run typecheck
```

When touching integration boundaries, also run the relevant focused integration suite.

## Product Spine

The core primitive is `Workflow Run`, not tracker issue. Trackers are intake, mirror, and projection adapters. CLI is primary, TUI is next, HTTP API is support/internal, and web frontend is excluded for now.
