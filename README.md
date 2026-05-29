# Risoluto

Risoluto is a workflow-run-centered background agent orchestration system for engineering work.

This repository is the public canonical v1 foundation for the product. It starts from a clean `0.1.0` baseline with useful backend/source code preserved, old git history excluded, and the web frontend/docs-site intentionally absent.

## Current Shape

- Primary product surface: CLI.
- Next first-class surface: TUI.
- Support/internal surface: HTTP API.
- Core primitive: Workflow Run.
- Planning source of truth: Linear, with selected public GitHub issue mirrors.

## Development

Use Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run format:check
pnpm test
```

Useful focused checks:

```bash
pnpm run typecheck
pnpm run test:integration
pnpm run test:integration:live
pnpm run test:load
pnpm run circular
```

## Foundation Docs

- [Product spine](docs/product-spine.md)
- [Technical spine](docs/technical-spine.md)
- [Decision register](docs/decisions.md)
- [Roadmap](docs/roadmap.md)
- [Research → shipping pipeline](docs/research-to-shipping-pipeline.md)
- [Testing & release](docs/testing-and-release.md)

## What Is Not Here

The current web dashboard/frontend, docs-site, generated reports, runtime data, private research corpus, and old roadmap/status documents are not part of this v1 repository. They can be rebuilt or referenced later through the spine and backlog when they are current again.
