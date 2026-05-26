# PRDs

PRDs in this folder are the **canonical source of truth**. Each `docs/prds/<slug>.md` file is the authoritative copy; the matching Linear Project description is a generated mirror pushed by `/risoluto-to-prd`.

Linear caps Project descriptions at 255 chars, so the mirror is only the first 255 chars of the PRD body — content beyond that lives only in git, and the drift hook only protects the prefix.

## Editing a PRD

Open a PR against `docs/prds/<slug>.md`. The pre-push drift hook and the `prd-drift` GitHub Action will reject pushes where the Linear Project description has been edited outside this git-canonical path.

Do **not** edit Linear Project descriptions in the Linear UI. The drift hook is intentional friction — treat the Linear description as generated content.

## Resolving drift

When the pre-push hook blocks because a PRD and its Linear Project have diverged:

- **Git is right (reject the Linear edit):** re-run `/risoluto-to-prd <slug>`. The skill is idempotent and overwrites the Linear Project description from the current PRD file.
- **Linear is right (adopt the UI edit):** run `pnpm prd:reconcile <slug>`. This pulls the Linear description back into `docs/prds/<slug>.md`, creates a branch, and prints a `gh pr create` command. Merge the PR to accept.

## Frontmatter

Every PRD file carries this YAML frontmatter:

```yaml
slug: <slug>
linear_project: https://linear.app/<org>/project/<name>-<slugId>
synced_at: <ISO-8601 timestamp>
source_idea: research/ideas/<slug>/README.md
status: draft | approved | shipped | archived
```

The `slug` is the join key to `research/ideas/<slug>/` and `capability-backlog.md`. The `linear_project` URL is set by `/risoluto-to-prd` on first creation.

## Linear UI banner

Paste the following into every Linear Project description (below the auto-synced PRD body) so that anyone opening the project in Linear sees the edit path:

```
---
> **This description is generated from `docs/prds/<slug>.md` in git.**
> To edit, open a PR against the source file. Edits made here will be
> overwritten on the next sync and blocked by the pre-push drift hook.
---
```
