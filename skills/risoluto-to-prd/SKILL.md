---
name: risoluto-to-prd
description: 'Risoluto-repo PRD skill — invoke as **/risoluto-to-prd** (NOT /to-prd, which is the tracker-agnostic global skill). Promotes a Risoluto research idea from `## Why us / why now` + `## Smallest shippable shape` (filled by `/risoluto-grill`) into a canonical PRD at `docs/prds/<slug>.md`, a matching Linear Project (via the `mcp__linear-server__*` MCP) whose description mirrors the PRD body, and a pushed feature branch (`pipeline/<slug>-prd`) — then update the idea README frontmatter (`linear_project`, `prd_file`) so the next invocation auto-detects sync mode. The skill stops short of `gh pr create`; it prints the suggested PR command so the operator opens the PR when they''re ready. **Idempotent on re-run:** the first call on a slug CREATES the Linear Project + PRD + branch; subsequent calls SYNC by overwriting the Linear Project description from the current `docs/prds/<slug>.md` without spawning a second Project. Mode is decided from the idea README''s `linear_project` frontmatter (null → create, set → sync). Use this skill whenever Omer says `/risoluto-to-prd`, "promote <slug> to a PRD", "write a PRD for <slug>", "push <slug> to Linear", "create a Linear Project from this idea", "resync <slug> to Linear", "overwrite the Linear PRD from git", "reject the Linear edit on <slug>", or any variation that implies turning a clustered, grilled idea into a Linear Project + git-canonical PRD. Also trigger when Omer mentions the planning-pipeline phase 3.2 work or wants to test the PRD drift hook from 3.3 — the sync path through this skill IS the git-is-canon push direction. Companion to Phase 3.2 of `docs/research-to-shipping-pipeline.md`. **Fork of the global `~/.claude/skills/to-prd/` skill** — the generic skill stays tracker-agnostic; this one is Linear MCP only and publishes to the Ninetech Linear team.'
---

# risoluto-to-prd

Idea-to-PRD-to-Linear sharpener for the Risoluto planning pipeline. Phase 3.2 of the planning-pipeline roadmap. **Fork of `~/.claude/skills/to-prd/`** — keep the global skill generic, never edit it. Linear-specific behaviour and the docs/prds/ layout live here.

## What this skill produces

For one `<idea-slug>` per invocation, this skill produces:

1. `docs/prds/<slug>.md` — the canonical PRD, with frontmatter (`slug`, `linear_project`, `synced_at`, `source_idea`, `status: draft`) and a body that follows the template under [PRD body template](#prd-body-template).
2. A Linear Project on the `Ninetech` team whose description is the PRD body (everything below the frontmatter). The Project's URL becomes the idea README's `linear_project` value.
3. A pushed feature branch `pipeline/<slug>-prd` containing one commit (`docs: add PRD for <slug>`) with just the new PRD file. **The skill does NOT call `gh pr create`** — it prints the suggested `gh pr create` command instead so the operator opens the PR when ready (memory: `feedback-skills-no-auto-pr`).
4. Updated frontmatter on `research/ideas/<slug>/README.md` (`linear_project`, `prd_file`) — committed locally in the `research/` submodule on `master`, **not pushed**. The operator pushes the submodule before merging the eventual PR.

On re-run (idempotent SYNC mode):

- No second Linear Project.
- The existing Project's description is overwritten from the current `docs/prds/<slug>.md` body.
- The PRD's `synced_at` is bumped; no branch, no commit, no PR command suggestion (the operator commits the synced_at bump only if they care to persist it).

## Hard preconditions

Stop and report if any of these fail. Do **not** retry MCP auth from inside this skill — if Linear MCP errors, surface it to the operator.

| Check                                      | Command / verification                                                                             | If it fails                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Run from repo root                         | `test -f package.json && test -f .gitmodules`                                                      | Tell Omer to `cd` into the `risoluto` checkout root.                                |
| `research/` initialised                    | `git submodule status research` starts with a space                                                | Tell Omer to `git submodule update --init research` or `/init-research`.            |
| Idea README exists                         | `test -f research/ideas/<slug>/README.md`                                                          | Tell Omer to run `/risoluto-synthesizer` first.                                     |
| `## Why us / why now` is non-empty         | preload bundle's `why_us_filled === true`                                                          | Tell Omer to run `/risoluto-grill <slug>` first — the PRD pulls "why us" from this. |
| `## Smallest shippable shape` is non-empty | preload bundle's `smallest_shape_filled === true`                                                  | Same as above — `/risoluto-grill` fills both.                                       |
| Linear MCP responding (OAuth complete)     | Any `mcp__linear-server__list_teams` call succeeds                                                 | Surface the MCP error verbatim to Omer; do not retry auth.                          |
| Working tree clean at the paths we touch   | `git status --porcelain -- docs/prds/<slug>.md research` empty                                     | Tell Omer to commit or stash before running.                                        |
| Submodule on `master` with clean tree      | `git -C research branch --show-current` is `master` and `git -C research status --porcelain` empty | Submodule must be in a known state — checkout master + commit/stash.                |

## Pipeline

Three steps: **preload**, **compose + push**, **write**. The compose step (synthesising the PRD body) happens in the agent's head; both deterministic scripts handle context gathering and final IO so re-runs are idempotent.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-to-prd/scripts/preload.mjs <idea-slug>
```

Stdout: a JSON document with the mode (`create` | `sync`), the idea README path, evidence target + source paths, `RISOLUTO_FEATURES.md` mentions of the slug (the spine entries Risoluto already ships in the same neighbourhood — the strongest "why us" anchor), the `capability-backlog.md` row, and the existing PRD path if any.

Stderr: a one-line summary (mode, counts, status). Show Omer the summary; do not dump the JSON to the conversation unless he asks.

Then read the files the bundle points at — at minimum the idea README, every cited target README, the backlog row, and any `RISOLUTO_FEATURES.md` mentions. Source files (`evidence_sources`) are deep-dive material — skim only if the targets don't give you enough material for the body.

### Step 2 — Compose the PRD body (CREATE mode only)

Synthesise a PRD body using the template under [PRD body template](#prd-body-template), grounded in:

- The idea README's `## Why us / why now` and `## Smallest shippable shape` (operator-owned, post-grill) — these are load-bearing for `Problem Statement`, `Solution`, and `Out of Scope`.
- The synthesizer-owned `## Evidence`, `## Targets that ship this`, `## Variants observed` — these inform `Implementation Decisions` (what patterns peers have already converged on) and `User Stories` (real flows that already work elsewhere).
- `RISOLUTO_FEATURES.md` mentions — Risoluto's existing surface area in this neighbourhood. The PRD should layer onto, not duplicate, what already ships.
- The `capability-backlog.md` row's `category` — keeps the PRD anchored to the Risoluto capability vocabulary.

Write the composed body to a temp file (e.g., `/tmp/risoluto-to-prd-<slug>-body.md`). The body is everything **below** the YAML frontmatter — the script writes the frontmatter itself.

> **In SYNC mode, skip Step 2 and Step 3** — the existing `docs/prds/<slug>.md` body on disk is canon. Read it, push it as-is to Linear, then run Step 4 in `--mode sync`.

### Step 3 — Push to Linear via MCP (CREATE mode)

Call `mcp__linear-server__save_project` with:

- `name`: `<slug>` (or a humanised variant; the slug is stable and identifies the project)
- `description`: the PRD body composed in Step 2 (literal markdown, no escape sequences — pass real newlines)
- `addTeams`: `["Ninetech"]` (the default team — only one exists in this workspace; do not ask)
- `state`: `"planned"` (Linear default — leave it; status field on the PRD's git frontmatter is the canonical status)

Capture the returned project's `url` (full Linear URL like `https://linear.app/ninetech/project/<slug>-<random>/overview`). That URL becomes the PRD frontmatter's `linear_project` value.

**After the project is created, instruct the operator to paste the Linear UI banner into the new Linear Project's description.** The banner template is defined in `docs/prds/README.md` under "Linear UI banner". Steps:

1. Open the newly created Linear Project at the captured URL.
2. In the project description, append (below the auto-synced PRD body) the banner block from `docs/prds/README.md`:
   ```
   ---
   > **This description is generated from `docs/prds/<slug>.md` in git.**
   > To edit, open a PR against the source file. Edits made here will be
   > overwritten on the next sync and blocked by the pre-push drift hook.
   ---
   ```
3. Save the description in the Linear UI.

This is a **manual operator step** — the MCP `save_project` call above sets the PRD body, but the banner must be appended via the Linear UI because it is human-facing context, not part of the git-canonical body. Do not include the banner in `--body-file` or in `docs/prds/<slug>.md`.

### Step 3' — Push to Linear via MCP (SYNC mode)

Read `docs/prds/<slug>.md` from disk. Split frontmatter from body. Call `mcp__linear-server__save_project` with:

- `id`: the existing project's UUID (look it up with `mcp__linear-server__get_project --query <existing-url-slug>` if you only have the URL; or extract from the URL with `mcp__linear-server__list_projects --query <slug>` and match on name)
- `description`: the on-disk PRD body
- **Do NOT** pass `addTeams` / `setTeams` / `name` on update — only `id` + `description`.

### Step 4 — Write (CREATE)

```bash
node skills/risoluto-to-prd/scripts/write.mjs <idea-slug> \
  --mode create \
  --body-file /tmp/risoluto-to-prd-<slug>-body.md \
  --linear-project <linear-project-url>
```

The script:

1. Writes `docs/prds/<slug>.md` with frontmatter (`slug`, `linear_project`, `synced_at`, `source_idea`, `status: draft`) and the body from `--body-file`.
2. Updates `research/ideas/<slug>/README.md` frontmatter — sets `linear_project` and `prd_file`.
3. Commits the idea README change in the submodule on its `master` branch (local — operator pushes manually).
4. Creates `pipeline/<slug>-prd` branch in the superproject, commits the new PRD file, pushes with `--recurse-submodules=no` (`-u origin`).
5. Prints the suggested `gh pr create --base master --head pipeline/<slug>-prd --title ... --body ...` command to stderr so the operator can open the PR themselves.
6. Switches the superproject back to the original branch.

The skill never calls `gh pr create` directly. Surface the printed PR command to Omer; he decides when to open the PR.

### Step 4' — Write (SYNC)

```bash
node skills/risoluto-to-prd/scripts/write.mjs <idea-slug> --mode sync
```

The script bumps `synced_at` in `docs/prds/<slug>.md`'s frontmatter (body untouched — Linear push already happened in Step 3'). No branches, no commits, no PRs. Tell Omer: the synced_at bump lives in the working tree only; commit `docs/prds/<slug>.md` if he wants to persist it.

## PRD body template

The PRD body (everything below frontmatter) follows this structure. Use the **exact** section headings — Phase 3.3's drift hook does a literal diff against the Linear Project description.

```markdown
## Problem Statement

[The problem from the operator's / Risoluto-user's perspective. 1–3 paragraphs.
Anchor to "Why us / why now" from the idea README — what does this neighbourhood
look like across the cited peers, and what gap does Risoluto fill?]

## Solution

[What ships, from the Risoluto-user's perspective. Cite the "Smallest shippable
shape" from the idea README. Concrete enough that a reader can picture the
seam without reading the implementation.]

## User Stories

A long, numbered list of user stories. Each in the format:

1. As a <Risoluto operator / agent author / CI consumer>, I want <feature>, so that <benefit>.

[Cover the golden path, edge cases, and how this interacts with neighbouring
Risoluto features (cross-reference RISOLUTO_FEATURES.md if relevant).]

## Implementation Decisions

[Architectural decisions, module boundaries, schemas, and how this layers onto
existing Risoluto. Reference cited targets' implementations when they encode a
decision more precisely than prose. Avoid file paths and code snippets — they
rot fast. Inline schema / state-machine fragments only when prose would be
worse.]

## Testing Decisions

[What makes a good test for this surface — what external behaviour matters,
what's implementation detail. Reference prior-art tests in the codebase by
shape, not file path.]

## Out of Scope

[Explicit non-goals. Pull from `## Smallest shippable shape` in the idea
README — anything the operator scoped out is out of scope here too.]

## Further Notes

[Open questions, future extensions, anything that didn't fit elsewhere.]
```

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists in this workspace. If a future operator's workspace has multiple teams, the skill would need to ask — but for now, no ask.
- **Linear MCP errors are operator concerns, not skill bugs.** If `mcp__linear-server__*` returns an error, surface it verbatim to Omer and stop. Do not retry, do not fall back to anything else.
- **The PRD body in git is canon.** Linear's description is a generated mirror. If Omer asks "is the Linear edit kept or the git edit?", the answer is always git (this skill is the git→Linear push path; Phase 3.3 enforces it).
- **`pipeline/<slug>-prd` branch namespace** is reserved for this skill. Don't reuse it for anything else. If it already exists locally (re-run of CREATE on a fresh slug), the write script refuses — delete the stale branch first.
- **Don't push the `research/` submodule from inside this skill.** The submodule push is a separate, operator-driven action. The write script's final message reminds the operator to push the submodule before merging the PR — surface that message to Omer.
- **The skill IS the sync path.** There is no `pnpm prd:reconcile` for the "git is canon, push to Linear" direction — that's just this skill in SYNC mode. (Phase 3.3 will add `pnpm prd:reconcile` for the **other** direction — adopt the Linear edit.)
- **Idempotency:** re-running CREATE mode on a slug that already has `linear_project` set in the idea README is an error. The script refuses; tell Omer to either null the field manually if they want to recreate, or use SYNC mode if the existing project is fine.

## Companion files

- `docs/research-to-shipping-pipeline.md` — Phase 3.2 spec and the broader pipeline.
- `~/.claude/skills/to-prd/` — the generic upstream skill this forks from. Do not edit it; this fork is the Risoluto-specific variant.
- `skills/risoluto-grill/` — Phase 3.1; produces the idea README's `## Why us / why now` and `## Smallest shippable shape` that this skill depends on.
