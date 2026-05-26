---
name: v1-check
description: Run the canonical Risoluto v1 pre-commit / pre-PR gate (build → lint → format:check → test → typecheck). Use when the user says "/v1-check", asks to "run checks", "verify the branch", "run the gate", or before pushing / opening a PR. Stops at the first failing step and surfaces the failing command's output verbatim.
---

# /v1-check

Run the canonical Risoluto v1 verification gate, in order. Stop at the first failure and surface the failing command's output unedited so the user can act on it.

## Steps (run in this order, stop on first non-zero exit)

```bash
pnpm run build
pnpm run lint
pnpm run format:check
pnpm test
pnpm run typecheck
```

## Behavior

- **Run each command separately**, not chained with `&&`, so you can report per-step status (pass / fail / skipped) without losing which step failed.
- **Stop at the first failure.** Do not run downstream steps — they produce noise that hides the real fault.
- On failure, print the full stdout/stderr of the failing step verbatim. Do not summarize the error away.
- On full pass, print a one-line confirmation of all 5 steps and any non-zero warnings worth surfacing (e.g., lint warnings that did not fail the run).

## When to extend

If the user's changes touched integration boundaries (anything under `src/integrations/`, `src/live/`, HTTP routes, or `src/storage/` adapters), also run the relevant focused integration suite **after** the gate passes:

- `pnpm run test:integration` — default integration suite
- `pnpm run test:integration:live` — real external APIs (needs `.env.live.local`)

Ask the user before running `test:integration:live` — it makes real API calls.

## What this skill is NOT

- Not a substitute for the husky pre-commit hook (which runs gitleaks + lint-staged on staged files only). `/v1-check` is the broader pre-PR gate.
- Not a fix-it command. If a step fails, report it; do not silently fix-and-rerun. The user decides whether to fix or amend the scope.
