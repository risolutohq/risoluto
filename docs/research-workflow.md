# Research Workflow

> How raw research flows through synthesis, grilling, and PRD authoring into Risoluto's canonical planning surface (Linear).
> Companion reading: [planning-pipeline-roadmap.md](./planning-pipeline-roadmap.md) (build phases), [capability-backlog.md](./capability-backlog.md) (idea ledger).

## Surfaces

| Surface                             | Role                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| **`research/` submodule** (private) | Per-target capture, idea clusters, and Obsidian vault. Operator intel.                   |
| **`capability-backlog.md`**         | Living idea ledger. Synthesizer writes `idea`-status rows; operator promotes or drops.   |
| **`docs/prds/`**                    | Canonical PRD files (git). Linear Project descriptions are generated mirrors.            |
| **Linear**                          | Canonical planning for implementation. Projects + flat Issues with blocked-by relations. |
| **`docs/`** (this repo)             | Current-truth product / technical / decision docs.                                       |
| **Operator's Obsidian vault**       | `~/Documents/my-vault/` — long-tail thinking, separate from `research/`.                 |

**No GitHub Issues mirror for now.** Public exposure of accepted work is deferred. Linear is the sole planning surface; GitHub Issues may be reactivated later for selective public visibility.

## Flow

```
/risoluto-researcher <urls|pasted-text+url>
   └─→ research/targets/<slug>/README.md  +  sources/<source-slug>.md
        └─→ /risoluto-synthesizer
             └─→ research/ideas/<slug>/README.md
                  └─→ capability-backlog.md row (status: idea)
                       └─→ (operator picks)
                            └─→ /risoluto-grill <idea-slug>
                                 └─→ status: idea → ready
                                      └─→ /grill-with-docs
                                           └─→ docs updates / new ADR
                                                └─→ /to-prd <idea-slug>
                                                     └─→ docs/prds/<slug>.md  +  Linear Project
                                                          └─→ /to-issues <prd-slug>
                                                               └─→ Linear Issues (flat, blocked-by)
                                                                    └─→ /tdd <linear-ticket-ref>
                                                                         └─→ PR (back-comment to Linear)
```

**Two stages, one seam:**

- **Planning** (heavy): researcher → synthesizer → grill → PRD → issues. Mostly text and decisions.
- **Implementation** (lighter): TDD loop per ticket. The Linear ticket is the unit of work.

## Roles

- **Operator.** Owns the queue, decides what enters Linear, runs skills explicitly.
- **Skills.** Tooling for each step. All skill invocations are explicit — no auto-triggers.
- **Risoluto runtime.** Consumes Linear tickets as Engineering Intent; produces PRs back into the canonical repo.

## Frontmatter Contract

The pipeline's API is the frontmatter in every research and PRD file. JSON Schemas live under `research/.schemas/`:

| Schema file          | Validates frontmatter in                           |
| -------------------- | -------------------------------------------------- |
| `source.schema.json` | `research/targets/<slug>/sources/<source-slug>.md` |
| `target.schema.json` | `research/targets/<slug>/README.md`                |
| `idea.schema.json`   | `research/ideas/<slug>/README.md`                  |

PRD frontmatter (`docs/prds/<slug>.md`) is defined in the roadmap; no separate schema file yet.

**`additionalProperties: true` on every schema.** The `research/` vault is also an Obsidian vault — Web Clipper, Templater, and the operator inject fields (`tags:`, `aliases:`, plugin-specific keys). Schemas validate the pipeline-owned subset only; everything else passes through untouched.

**Slug collisions:** slugs are namespaced by type — `targets/<slug>/` and `ideas/<slug>/` can share the same string. Within a namespace, the researcher/synthesizer refuses to create a duplicate and halts.

**Validation:** `pnpm validate:research` walks the corpus and validates every file against its schema.

See [planning-pipeline-roadmap.md § Frontmatter Contract](./planning-pipeline-roadmap.md#frontmatter-contract-the-api-of-the-pipeline) for the full field reference.

## Vault Overlay

The `research/` submodule doubles as an Obsidian vault. The `risoluto-vault` skill writes:

- `.obsidian/{app,appearance,core-plugins,community-plugins}.json` — forces relative markdown links (no wikilinks)
- `templates/source.md`, `templates/target-readme.md`, `templates/idea-readme.md` — matching the frontmatter contract
- Pre-canned Dataview queries: "untagged sources", "ideas with <2 evidence targets", "targets not refreshed in 90d"

**Pinned plugins:** Web Clipper, Dataview, Templater. Community plugins can't be installed from JSON config alone — the operator opens the vault in Obsidian once and installs them via the UI. The skill detects missing plugins and prints install instructions.

**Idempotent:** re-run repairs drift without overwriting operator preferences.

**Two separate vaults:** `~/Documents/my-vault/` (operator's personal vault) stays independent. `research/` is its own vault scoped to the research corpus.

## PRD Inversion

PRDs are canonical in **git** (`docs/prds/<slug>.md`), not in Linear. The Linear Project description is a generated mirror, pushed on creation and synced on re-run.

- **To edit a PRD:** open a PR against `docs/prds/<slug>.md`.
- **Do not edit Linear Project descriptions in the UI.** A `pre-push` hook diffs changed PRD files against their Linear Project descriptions and blocks push if they've drifted.
- **Two unblock paths** when drift is detected:
  - _Adopt the Linear edit:_ `pnpm prd:reconcile <slug>` pulls the Linear description back into git.
  - _Reject the Linear edit:_ re-run `/risoluto-to-prd <slug>` — overwrites Linear from the current PRD.

## Ownership Rules

Synthesizer/skill-owned sections are **regenerated** on every run. Operator-owned sections **evolve forward** — never clobbered. See [planning-pipeline-roadmap.md § Ownership Rules](./planning-pipeline-roadmap.md#ownership-rules-synthesizer-vs-operator) for the full table.

## What This Workflow Is _Not_

- A ticket-management substitute for Linear. Tickets live in Linear.
- A backlog database. The backlog lives in [capability-backlog.md](./capability-backlog.md); tickets are the detail.
- A research corpus. Research lives in the private `research/` submodule.
- A bidirectional Linear ↔ git sync. Only git → Linear flows ship (on `to-prd`/`to-issues` create, and PR → Linear back-comment on PR open). The PRD drift hook is the only Linear-watching surface.

## Cadence

- New research target: explicit `/risoluto-researcher` invocation per target; output lands in `research/targets/<slug>/`.
- Synthesis: `/risoluto-synthesizer` reads all targets and writes/updates idea clusters. Runs at any corpus size.
- New decision: capture in [decisions.md](./decisions.md); promote to an ADR if hard-to-reverse.
- New capability: capture in [capability-backlog.md](./capability-backlog.md); promote to Linear when ready.
