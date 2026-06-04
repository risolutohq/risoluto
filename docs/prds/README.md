# PRDs

PRDs in this folder are the **canonical source of truth**. Each `docs/prds/<slug>.md` file is the authoritative copy; the matching Linear Project content body is a generated mirror pushed by `/risoluto-to-prd`.

Linear has two relevant Project fields:

- `description` — the short Project overview text. Keep this to a one-sentence summary.
- `content` — the full markdown body shown in Linear's Description area. This mirrors the full PRD body from git.

## Editing a PRD

Git stays the canonical source: edit `docs/prds/<slug>.md` and mirror it to Linear with `/risoluto-to-prd <slug>`. Keeping the Linear Project content body in sync is a **convention, not an enforced gate** — the former pre-push drift hook and `prd-drift` GitHub Action were removed, so the Linear Project may be edited directly when that is more convenient.

## Reconciling git ↔ Linear

When a PRD and its Linear Project have diverged and you want them back in sync:

- **Git is right (overwrite Linear):** re-run `/risoluto-to-prd <slug>`. The skill is idempotent and overwrites the Linear Project content from the current PRD file.
- **Linear is right (adopt the UI edit):** run `pnpm prd:reconcile <slug>`. This pulls the Linear content body back into `docs/prds/<slug>.md`, creates a branch, and prints a `gh pr create` command. Merge the PR to accept.

## Frontmatter

Every PRD file carries this YAML frontmatter:

```yaml
slug: <slug>
linear_project: https://linear.app/<org>/project/<name>-<slugId>
synced_at: <ISO-8601 timestamp>
source: docs/roadmap.md#<slug>
status: draft | approved | shipped | archived
```

The `slug` is the join key to the roadmap row (`docs/roadmap.md`), the PRD filename, and the Linear `from:prd-<slug>` label. The `linear_project` URL is set by `/risoluto-to-prd` on first creation.

`prd.schema.json` validates PRD frontmatter shape; run `pnpm validate:research` to check all PRDs in one pass.

## Linear Field Contract

`/risoluto-to-prd` writes the short overview into Linear `description` and the full PRD body into Linear `content`. Do not paste banners into the generated content body; that would create drift from git.
