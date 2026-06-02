# Contributing

[AGENTS.md](AGENTS.md) is the single source of truth for working rules in this repo — for humans and AI agents alike. This file is a short front door; when the two disagree, AGENTS.md wins.

## Prerequisites & setup

Follow the [Quickstart](README.md#quickstart) in the README: Node.js >= 22, pnpm 11, and `pnpm install && pnpm run build`. Docker is required to run agent workloads, and contributors working on the planning pipeline also need the private `research/` submodule (see AGENTS.md).

## Verification gate

Run the canonical gate before committing or opening a PR — same order CI uses:

```bash
pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck && pnpm run typecheck:coverage
```

When a change touches an integration boundary, also run the relevant focused suite (`test:integration`, `test:integration:sqlite`, `test:integration:contracts`, `test:integration:live`, `test:load`, `test:docker`). See [docs/testing-and-release.md](docs/testing-and-release.md) for the test tiers and the `1.0.0` gate.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by `commitlint` (`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `ci:` / `refactor:`). The Husky pre-commit hook runs `gitleaks` (secret scan) and `lint-staged` (eslint --fix + prettier on staged files). `semantic-release` derives the changelog and tags from commit subjects, so write subjects accordingly. Never leak hostnames, credentials, or infrastructure details in commit messages.

## Pull requests

- Keep changes small and scoped to the request; match existing style.
- Do not rewrite git history or force-push.
- Include evidence (commands run, output) for the change in the PR description.

For the full working rules, code-style ceilings, and the research → shipping pipeline, read [AGENTS.md](AGENTS.md) and [docs/research-to-shipping-pipeline.md](docs/research-to-shipping-pipeline.md).
