---
name: risoluto-to-prd
description: 'Risoluto-repo PRD skill; invoke as /risoluto-to-prd, not the generic /to-prd. Use when Omer says "promote <slug> to a PRD", "write a PRD for <slug>", "push <slug> to Linear", "create a Linear Project from this roadmap item", "resync <slug> to Linear", "overwrite the Linear PRD from git", or similar. Promotes a next-status roadmap row into `docs/prds/<slug>.md`, mirrors it to a Linear Project, pushes `pipeline/<slug>-prd`, flips the row to building, and prints but does not run `gh pr create`. Re-runs sync the Linear Project from the git PRD.'
---

# risoluto-to-prd

Roadmap-row-to-PRD-to-Linear sharpener for the Risoluto planning pipeline. Stage 1 of the pipeline. **Fork of `~/.claude/skills/to-prd/`** — keep the global skill generic, never edit it. Linear-specific behaviour and the docs/prds/ layout live here.

## What this skill produces

For one `<slug>` per invocation (the slug must already exist as a roadmap row in `docs/roadmap.md`):

1. `docs/prds/<slug>.md` — the canonical PRD, with frontmatter (`slug`, `linear_project`, `synced_at`, `source: docs/roadmap.md#<slug>`, `status: draft`) and a body following the [PRD body template](#prd-body-template).
2. A Linear Project on the `Ninetech` team whose short `description` is a one-sentence summary and whose `content` is the PRD body. The Project URL stamps the roadmap row's Status cell.
3. A pushed feature branch `pipeline/<slug>-prd` with one commit (`docs: add PRD for <slug>`) carrying **both** `docs/prds/<slug>.md` and `docs/roadmap.md` (row flipped to `[building](<url>)`). **The skill never calls `gh pr create`** — it prints the command so the operator opens the PR (memory: `feedback-skills-no-auto-pr`).

The skill is its own git→Linear sync path. **CREATE** mints the project the first time; **SYNC** (re-run) overwrites the existing project's `content` from the on-disk PRD, bumps `synced_at` in the working tree, and writes no branch/commit/PR. `preload.mjs` detects which mode applies.

## Hard preconditions

The four shared rows live in [`../references/preconditions.md`](../references/preconditions.md) (repo root, `research/` init, Linear reachable, working tree clean at the paths we touch). Plus two skill-specific checks:

| Check                | Verification                                            | If it fails                                                                          |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Roadmap row exists   | preload bundle returns a non-null `roadmap_row`        | Tell Omer to add the row to `docs/roadmap.md` first (status `next`).                 |
| Row status is `next` | `roadmap_row.status` equals `next`                     | Warn Omer — only `next` rows are PRD-ready; confirm before proceeding if `idea`/`building`. |

Stop and report on the first failure. Do **not** retry Linear auth from inside this skill.

## Pipeline

One path; the only branch is `mode` (`create` | `sync`), which `preload.mjs` decides. The compose step happens in the agent's head; the deterministic scripts handle context gathering and final IO. Linear operations bind to [`../references/linear-access.md`](../references/linear-access.md) — that file owns every Linear mutation; this skill carries none inline.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-to-prd/scripts/preload.mjs <slug>
```

Stdout: a JSON document with the `mode`, the roadmap row fields (`item`, `why_now`, `size`, `status`, `research_link`), the resolved `research_path`, the PRD path, whether it already exists, and `RISOLUTO_FEATURES.md` mentions of the slug. Stderr: a one-line summary — show Omer that, don't dump the JSON unless asked.

Then read what the bundle points at: the roadmap row context, the research file at `research_path` (the primary evidence), and any `RISOLUTO_FEATURES.md` mentions.

### Step 2 — Compose the PRD body (CREATE mode only)

Synthesise a body using the [PRD body template](#prd-body-template), grounded in:

- The roadmap row's `why_now` — load-bearing for `Problem Statement`.
- The linked research at `research_path` (a researcher output's `## Candidate features` / `## Leech takeaways`, or the relevant ingest wiki note) — informs `Solution`, `User Stories`, `Implementation Decisions`, `Out of Scope`.
- `RISOLUTO_FEATURES.md` mentions — layer onto, never duplicate, what already ships.

Write the body (everything **below** the frontmatter; the write script writes the frontmatter) to `/tmp/risoluto-to-prd-<slug>-body.md`.

> **SYNC mode skips Steps 2 and 3's compose** — the on-disk `docs/prds/<slug>.md` body is canon. Read it and push it as-is.

### Step 3 — Publish to Linear

Bind to [Create / update a project (PRD body)](../references/linear-access.md#create--update-a-project-prd-body):

- **CREATE** → `projectCreate` (born owned: `leadId` = the `LINEAR_API_KEY` viewer, `priority: 2`). Capture the returned `url` — it becomes the frontmatter `linear_project` and the roadmap Status link.
- **SYNC** → resolve the project by the `slugId` from the existing `linear_project` URL, then `projectUpdate` with the on-disk body. SYNC never re-asserts lead or priority.

### Step 4 — Write

```bash
node skills/risoluto-to-prd/scripts/write.mjs <slug> --mode <create|sync> \
  [--body-file /tmp/risoluto-to-prd-<slug>-body.md --linear-project <url>]
```

- **`--mode create`** writes `docs/prds/<slug>.md` (frontmatter + body), flips the roadmap row to `building` via `setStatus(model, slug, "building", url)`, creates `pipeline/<slug>-prd`, commits **both** files, pushes `-u origin`, prints the suggested `gh pr create --base master --head pipeline/<slug>-prd …` to stderr, and switches back to the original branch.
- **`--mode sync`** bumps only `synced_at` in the PRD frontmatter (body untouched — the Linear push already happened in Step 3). No branch, no commit, no PR. The bump lives in the working tree; Omer commits it if he wants to persist it.

The skill never runs `gh pr create`. Surface the printed command to Omer; he decides when to open the PR.

## PRD body template

The body (everything below frontmatter) uses these **exact** section headings — Stage 1.3's drift hook (`pnpm prd:drift-check`) does a literal diff against the Linear Project content.

```markdown
## Problem Statement

[The problem from the operator's / Risoluto-user's perspective. 1–3 paragraphs.
Anchor to the roadmap row's "why now" — what does this neighbourhood look like
across the cited peers (research/targets/), and what gap does Risoluto fill?]

## Solution

[What ships, from the Risoluto-user's perspective. Concrete enough to picture the
seam without reading the implementation. Source from the research file's
"## Candidate features" or "## Leech takeaways".]

## User Stories

A long, numbered list. Each: "As a <Risoluto operator / agent author / CI consumer>,
I want <feature>, so that <benefit>." Cover the golden path, edge cases, and
interactions with neighbouring features. Each story must imply a _verifiable
behaviour_ — if you cannot name the check that proves it done, it is too vague and
`/risoluto-to-issues` cannot derive a red test from it.

## Implementation Decisions

[Architectural decisions, module boundaries, schemas, and how this layers onto
existing Risoluto. Reference cited targets when they encode a decision more
precisely than prose. Avoid file paths and code snippets — they rot fast.]

## Testing Decisions

[What makes a good test for this surface — what external behaviour matters, what's
implementation detail. Reference prior-art tests by shape, not file path.]

## Out of Scope

[Explicit non-goals. Anything scoped out of the roadmap row belongs here too.]

## Further Notes

[Open questions, future extensions, anything that didn't fit elsewhere.]
```

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking** — only one exists.
- **Minted projects are born owned and prioritized.** CREATE always sets `leadId` + `priority: 2`; SYNC never re-asserts them (ownership/priority become operator-owned once the project exists).
- **The PRD body in git is canon.** Linear's `content` is a generated mirror — if asked "git or Linear edit?", the answer is always git.
- **`pipeline/<slug>-prd` is reserved for this skill.** If it already exists on a CREATE re-run, the write script refuses — delete the stale branch first.
- **Idempotency:** re-running CREATE when `docs/prds/<slug>.md` exists is an error; the write script refuses — use SYNC.
- **Contract-first, behavioural acceptance.** Every User Story must imply a falsifiable assertion a test could check ("a run that fails at step 3 replays from 3, not 0"), not an adjective. Do not restate the global gate. The non-test-caller bar is in [`../references/reachability.md`](../references/reachability.md). If the row's intent is too fuzzy to state a verifiable behaviour, sharpen it before writing.
- **Skills propose; the founder disposes.** Only touches rows already promoted to `next`; never reorders, creates, or deletes roadmap rows.

## Companion files

- `../references/linear-access.md` — owns every Linear operation (issue- and project-level).
- `../references/preconditions.md`, `../references/reachability.md` — shared gate + invariant.
- `docs/research-to-shipping-pipeline.md` — Stage 1 spec and the broader pipeline.
- `docs/roadmap.md` — the single plan surface; the slug here is the join key.
- `scripts/roadmap.mjs` — shared roadmap-table helper; import it, never reimplement.
- `~/.claude/skills/to-prd/` — the generic upstream skill this forks from. Do not edit it.
