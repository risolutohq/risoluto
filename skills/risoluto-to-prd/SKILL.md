---
name: risoluto-to-prd
description: 'Risoluto-repo PRD skill; invoke as /risoluto-to-prd, not the generic /to-prd. Use when Omer says "promote <slug> to a PRD", "write a PRD for <slug>", "push <slug> to Linear", "create a Linear Project from this roadmap item", "resync <slug> to Linear", "overwrite the Linear PRD from git", or similar. Promotes a next-status roadmap row into `docs/prds/<slug>.md`, mirrors it to a Linear Project, pushes `pipeline/<slug>-prd`, flips the row to building, and prints but does not run `gh pr create`. Re-runs sync the Linear Project from the git PRD.'
---

# risoluto-to-prd

Roadmap-row-to-PRD-to-Linear sharpener for the Risoluto planning pipeline. Stage 1 of the pipeline. **Fork of `~/.claude/skills/to-prd/`** — keep the global skill generic, never edit it. Linear-specific behaviour and the docs/prds/ layout live here.

## What this skill produces

For one `<slug>` per invocation (the slug must already exist as a roadmap row in `docs/roadmap.md`), this skill produces:

1. `docs/prds/<slug>.md` — the canonical PRD, with frontmatter (`slug`, `linear_project`, `synced_at`, `source: docs/roadmap.md#<slug>`, `status: draft`) and a body following the template under [PRD body template](#prd-body-template).
2. A Linear Project on the `Ninetech` team whose short `description` is a one-sentence summary and whose `content` is the PRD body (everything below the frontmatter). The Project's URL stamps the roadmap row's Status cell.
3. A pushed feature branch `pipeline/<slug>-prd` containing one commit (`docs: add PRD for <slug>`) with **both** `docs/prds/<slug>.md` and `docs/roadmap.md` (row flipped to `[building](<linear-project-url>)`). **The skill does NOT call `gh pr create`** — it prints the suggested command so the operator opens the PR when ready (memory: `feedback-skills-no-auto-pr`).

On re-run (idempotent SYNC mode):

- No second Linear Project.
- The existing Project's `content` is overwritten from the current `docs/prds/<slug>.md` body.
- The PRD's `synced_at` is bumped in the working tree; no branch, no commit, no PR command (the operator commits the bump only if they want to persist it).

## Hard preconditions

Stop and report if any of these fail. Do **not** retry Linear auth from inside this skill.

| Check                                | Command / verification                                                   | If it fails                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Run from repo root                   | `test -f package.json`                                                   | Tell Omer to `cd` into the `risoluto` checkout root.                                                           |
| `research/` initialised              | `git submodule status research` starts with a space                      | Tell Omer to `git submodule update --init research` or `/init-research`.                                       |
| Roadmap row exists                   | preload bundle returns a `roadmap_row` object (non-null)                 | Tell Omer to add the row to `docs/roadmap.md` first (status `next`).                                           |
| Row status is `next`                 | `roadmap_row.status` equals `next`                                       | Warn Omer — only `next` rows are ready for a PRD; confirm before proceeding if status is `idea` or `building`. |
| Linear API responding                | `LINEAR_API_KEY` is set and a Linear GraphQL team/project query succeeds | Surface the Linear API error verbatim to Omer; do not retry auth.                                              |
| Working tree clean at paths we touch | `git status --porcelain -- docs/prds/<slug>.md docs/roadmap.md` empty    | Tell Omer to commit or stash before running.                                                                   |

## Pipeline

Three steps: **preload**, **compose + push to Linear**, **write**. The compose step happens in the agent's head; the deterministic scripts handle context gathering and final IO.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-to-prd/scripts/preload.mjs <slug>
```

Stdout: a JSON document with the mode (`create` | `sync`), the roadmap row fields (`item`, `why_now`, `size`, `status`, `research_link`), the resolved `research_path` (path to `research/targets/<slug>/README.md` or a wiki note, if it exists), the PRD path, whether it already exists, and `RISOLUTO_FEATURES.md` mentions of the slug.

Stderr: a one-line summary (mode, counts). Show Omer the summary; do not dump the JSON to the conversation unless he asks.

Then read the files the bundle points at — at minimum the roadmap row context, the research file at `research_path` (if present), and any `RISOLUTO_FEATURES.md` mentions. The research file is the primary evidence for the PRD body.

### Step 2 — Compose the PRD body (CREATE mode only)

Synthesise a PRD body using the template under [PRD body template](#prd-body-template), grounded in:

- The roadmap row's `why_now` — the "why now" rationale is load-bearing for `Problem Statement`.
- The linked research at `research_path` (the `## Candidate features` and `## Leech takeaways` sections from a researcher output, or the relevant wiki note from ingest) — these inform `Solution`, `User Stories`, `Implementation Decisions`, and `Out of Scope`.
- `RISOLUTO_FEATURES.md` mentions — Risoluto's existing surface area in this neighbourhood. The PRD should layer onto, not duplicate, what already ships.

Write the composed body to a temp file (e.g., `/tmp/risoluto-to-prd-<slug>-body.md`). The body is everything **below** the YAML frontmatter — the write script writes the frontmatter itself.

> **In SYNC mode, skip Step 2 and Step 3** — the existing `docs/prds/<slug>.md` body on disk is canon. Read it, push it as-is to Linear, then run Step 4 in `--mode sync`.

### Step 3 — Push to Linear via GraphQL (CREATE mode)

Do **not** use `mcp__linear.save_project` for the PRD body: that MCP surface cannot set Linear's
`content` field, and Linear's short `description` field is not where the PRD body belongs. Use
Linear GraphQL directly with `LINEAR_API_KEY`.

First resolve the Ninetech team ID:

```graphql
query FindTeam($key: String!) {
  teams(filter: { key: { eq: $key } }) {
    nodes {
      id
      key
      name
    }
  }
}
```

Then resolve the project **lead** — the founder who owns this PRD is the user behind `LINEAR_API_KEY`:

```graphql
query Me {
  viewer {
    id
    name
  }
}
```

Then call `projectCreate` with:

- `name`: `<slug>` (or a humanised variant; the slug is the stable join key)
- `teamIds`: `[<Ninetech team id>]` (the default team; only one exists in this workspace — do not ask)
- `description`: a clean one-sentence summary, max 255 chars
- `content`: the PRD body composed in Step 2 (literal markdown, real newlines — no escape sequences)
- `leadId`: the `viewer.id` resolved above — a minted PRD project is **born owned**, never an orphaned, unassigned Backlog container. An unowned + No-priority project reads as a planning-only design doc, not actionable work, which is exactly what an execution review flags.
- `priority`: `2` (High) — promoting a roadmap row to a PRD means it is real, active work. Stamp the priority at birth instead of leaving it at "No priority" for someone to notice and fix later.

```graphql
mutation CreateProject(
  $name: String!
  $teamIds: [String!]!
  $description: String!
  $content: String!
  $leadId: String!
  $priority: Int!
) {
  projectCreate(
    input: { name: $name, teamIds: $teamIds, description: $description, content: $content, leadId: $leadId, priority: $priority }
  ) {
    success
    project {
      id
      name
      url
      description
      content
      lead {
        id
        name
      }
      priority
    }
  }
}
```

Capture the returned project's `url` (full Linear URL like `https://linear.app/ninetech/project/<slug>-<random>/overview`). That URL becomes the PRD frontmatter's `linear_project` value and the roadmap Status cell link.

### Step 3' — Push to Linear via GraphQL (SYNC mode)

Read `docs/prds/<slug>.md` from disk. Split frontmatter from body. Look up the existing project by
the `slugId` extracted from frontmatter `linear_project`, then call `projectUpdate` with:

```graphql
query FindProject($slugId: String!) {
  projects(first: 1, filter: { slugId: { eq: $slugId } }) {
    nodes {
      id
      name
      slugId
      url
    }
  }
}
```

- `id`: the existing project's UUID
- `description`: a clean one-sentence summary, max 255 chars
- `content`: the on-disk PRD body

```graphql
mutation UpdateProject($id: String!, $description: String!, $content: String!) {
  projectUpdate(id: $id, input: { description: $description, content: $content }) {
    success
    project {
      id
      name
      url
      description
      content
    }
  }
}
```

### Step 4 — Write (CREATE)

```bash
node skills/risoluto-to-prd/scripts/write.mjs <slug> \
  --mode create \
  --body-file /tmp/risoluto-to-prd-<slug>-body.md \
  --linear-project <linear-project-url>
```

The script:

1. Writes `docs/prds/<slug>.md` with frontmatter (`slug`, `linear_project`, `synced_at`, `source: docs/roadmap.md#<slug>`, `status: draft`) and the body from `--body-file`.
2. Flips the roadmap row: calls `setStatus(model, slug, "building", linearProjectUrl)` and writes `docs/roadmap.md`.
3. Creates `pipeline/<slug>-prd` branch in the superproject, commits **both** `docs/prds/<slug>.md` and `docs/roadmap.md`, pushes with `-u origin`.
4. Prints the suggested `gh pr create --base master --head pipeline/<slug>-prd --title ... --body ...` command to stderr so the operator can open the PR themselves.
5. Switches back to the original branch.

The skill never calls `gh pr create` directly. Surface the printed PR command to Omer; he decides when to open the PR.

### Step 4' — Write (SYNC)

```bash
node skills/risoluto-to-prd/scripts/write.mjs <slug> --mode sync
```

The script bumps `synced_at` in `docs/prds/<slug>.md`'s frontmatter (body untouched — Linear push already happened in Step 3'). No branches, no commits, no PRs. Tell Omer: the `synced_at` bump lives in the working tree only; commit `docs/prds/<slug>.md` if he wants to persist it.

## PRD body template

The PRD body (everything below frontmatter) follows this structure. Use the **exact** section headings — Stage 1.3's drift hook (`pnpm prd:drift-check`) does a literal diff against the Linear Project content.

```markdown
## Problem Statement

[The problem from the operator's / Risoluto-user's perspective. 1–3 paragraphs.
Anchor to the roadmap row's "why now" rationale — what does this neighbourhood
look like across the cited peers (research/targets/), and what gap does Risoluto fill?]

## Solution

[What ships, from the Risoluto-user's perspective. Concrete enough that a reader
can picture the seam without reading the implementation. Source from the research
file's "## Candidate features" or "## Leech takeaways" sections.]

## User Stories

A long, numbered list of user stories. Each in the format:

1. As a <Risoluto operator / agent author / CI consumer>, I want <feature>, so that <benefit>.

[Cover the golden path, edge cases, and how this interacts with neighbouring
Risoluto features (cross-reference RISOLUTO_FEATURES.md if relevant). Each story must imply a
_verifiable behaviour_ — if you cannot name the check that would prove it done, the story is too
vague to ship and `/risoluto-to-issues` cannot derive a red test from it.]

## Implementation Decisions

[Architectural decisions, module boundaries, schemas, and how this layers onto
existing Risoluto. Reference cited targets' implementations when they encode a
decision more precisely than prose. Avoid file paths and code snippets — they
rot fast. Inline schema / state-machine fragments only when prose would be worse.]

## Testing Decisions

[What makes a good test for this surface — what external behaviour matters,
what's implementation detail. Reference prior-art tests in the codebase by
shape, not file path.]

## Out of Scope

[Explicit non-goals. Anything scoped out of the roadmap row belongs here too.]

## Further Notes

[Open questions, future extensions, anything that didn't fit elsewhere.]
```

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists in this workspace.
- **Minted projects are born owned and prioritized.** CREATE always sets `leadId` (the `LINEAR_API_KEY` user) and `priority: 2` (High) on `projectCreate`. A project with no lead and No priority looks like a planning-only container, not active work — the structural gap that makes a strong PRD read as an un-actionable design doc. SYNC mode (Step 3') deliberately does **not** re-assert lead or priority: once the project exists, ownership and priority are operator-owned, and a re-sync must not clobber a reassignment.
- **Linear API errors are operator concerns, not skill bugs.** If Linear GraphQL returns an auth or provider error, surface it verbatim to Omer and stop.
- **The PRD body in git is canon.** Linear's `content` is a generated mirror. If Omer asks "is the Linear edit kept or the git edit?", the answer is always git.
- **`pipeline/<slug>-prd` branch namespace** is reserved for this skill. If it already exists locally on a re-run of CREATE, the write script refuses — delete the stale branch first.
- **The skill IS the sync path.** There is no `pnpm prd:reconcile` for the git→Linear direction — that's this skill in SYNC mode. Stage 1.3 adds `pnpm prd:reconcile` for the other direction (adopt the Linear edit into git).
- **Idempotency:** re-running CREATE mode when `docs/prds/<slug>.md` already exists is an error. The write script refuses; tell Omer to use SYNC mode.
- **Contract-first, behavioural acceptance.** Every User Story must imply a _verifiable behaviour_ — a falsifiable assertion a test could check ("a run that fails at step 3 replays from 3, not 0"), not an adjective ("improve reliability"). `/risoluto-to-issues` turns these into the red-test acceptance criteria per slice, so a story with no nameable behaviour produces an un-runnable ticket. Do not restate the global gate (build / lint / test / typecheck / coverage) — every merge enforces it. If the roadmap row's intent is too fuzzy to state a verifiable behaviour, sharpen it before writing the PRD.
- **Skills propose; the founder disposes.** This skill only touches rows the founder has already promoted to `next`. It does not reorder, create, or delete roadmap rows.

## Companion files

- `docs/research-to-shipping-pipeline.md` — Stage 1 spec and the broader pipeline.
- `docs/roadmap.md` — the single plan surface; the slug here is the join key for everything.
- `scripts/roadmap.mjs` — shared helper for roadmap table read/edit; always import it, never reimplement.
- `~/.claude/skills/to-prd/` — the generic upstream skill this forks from. Do not edit it.
- `skills/risoluto-grill/` — critic step that produces research survivors; feeds the roadmap.
