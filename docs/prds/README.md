# PRDs

PRDs in this folder are the **canonical source of truth**. Each `docs/prds/<slug>.md` file is the authoritative copy; the matching Linear Project content body is a generated mirror pushed by `/risoluto-to-prd`.

Linear has two relevant Project fields:

- `description` — the short Project overview text. Keep this to a one-sentence summary.
- `content` — the full markdown body shown in Linear's Description area. This mirrors the full PRD body from git.

## Editing a PRD

Open a PR against `docs/prds/<slug>.md`. The pre-push drift hook and the `prd-drift` GitHub Action will reject pushes where the Linear Project content body has been edited outside this git-canonical path.

Do **not** edit the Linear Project Description body in the Linear UI. The drift hook is intentional friction — treat Linear content as generated from git. Editing the short overview is okay only when it remains a summary, not the PRD body.

## Resolving drift

When the pre-push hook blocks because a PRD and its Linear Project have diverged:

- **Git is right (reject the Linear edit):** re-run `/risoluto-to-prd <slug>`. The skill is idempotent and overwrites the Linear Project content from the current PRD file.
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
