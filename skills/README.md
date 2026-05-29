# Risoluto Skills

Index of the skills that operate this repo's **research → shipping pipeline**. Each lives in a
`skills/risoluto-*/` folder (plus `init-research`) and is symlinked into `.claude/skills/` and
`.agents/skills/`. Canonical references: [`docs/research-to-shipping-pipeline.md`](../docs/research-to-shipping-pipeline.md)
(the full funnel) and [`docs/product-spine.md`](../docs/product-spine.md) (the value model — the five
AFK jobs every candidate is gated against).

**The shape.** Two research modes feed one founder-owned roadmap; a `next` row flows through the
shared back-half to merged code. The **slug** is the join key (roadmap row ↔ PRD file ↔ `prd.slug`
frontmatter ↔ `from:prd-<slug>` Linear label). Governing rule: **skills propose; the founder
disposes** — skills only append `idea` rows; they never reorder, promote, or delete.

```
Mode A  researcher → dedup → grill ┐
                                   ├─▶ docs/roadmap.md ─▶ to-prd ─▶ to-issues ─▶ tdd ─▶ merge ─▶ post-merge CI records
Mode B  ingest (wiki + cite-or-drop)┘   (founder ranks/promotes)     next-bundle schedules parallel worktrees
```

## Setup & supporting tooling

| Skill                    | What it does                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/init-research`**     | Initialize or refresh the private `research/` submodule (`risolutohq/risoluto-research`). Idempotent. Hard prerequisite — most skills fail fast if it is missing.                                                                  |
| **`/risoluto-vault`**    | Configure `research/` as a scoped Obsidian vault: `.obsidian/` config, Templater templates, Dataview view notes, pinned plugin set, relative-link enforcement. Idempotent — repairs drift without clobbering operator preferences. |
| **`/risoluto-features`** | Regenerate `RISOLUTO_FEATURES.md`, the code-backed inventory of every shipped feature (two-repo map-reduce). It is the **dedup anchor** for both research modes and the home for the exit-gate usage signal.                       |
| **`/v1-check`**          | Run the canonical pre-commit / pre-PR gate in order: build → lint → format:check → test → typecheck → typecheck:coverage. Stops at the first failure and surfaces its output verbatim.                                             |

## Mode A — targeted adoption (study one source)

| Skill                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/risoluto-researcher <url>`** | Capture one source into `research/targets/<slug>/README.md` (+ `sources/`, regenerates `INDEX.md`). Extracts `## Candidate features` — each tagged with the **AFK job it serves** and a dedup flag (`new`/`merge`/`supersede`/`skip`, at feature **and** job layer) — plus `## Leech takeaways`. GitHub repos get deep `gh` capture. Hands survivors to grill.                                                                  |
| **`/risoluto-grill`**            | The **critic**. Runs the admission loop on post-dedup candidates: **Gate 1** thesis-alignment (serves an AFK job, else dropped) → **classification router** (`differentiator`/`table_stakes`/`nice_to_have`) → **Gate 2** class-specific justification (falsifiable bet / category credibility / cited demand) → cost + reversibility as ordering-only scores. The founder decides in/out; kept candidates become roadmap rows. |

## Mode B — sense-making / innovation (across all research)

| Skill                  | What it does                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/risoluto-ingest`** | Read **all** targets + sources, build the connected `research/wiki/` (a home note + concept notes wikilinking targets together), then emit **cite-or-drop** idea rows — each must name the dots it connects, the gap it fills, **and** the AFK job it serves, or it is dropped. Idempotent; run anytime the corpus grows. |

## Back-half — a `next` roadmap row → merged code

| Skill                            | What it does                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`/risoluto-to-prd <slug>`**    | Promote a `next` row to `docs/prds/<slug>.md` + a mirrored Linear Project + a pushed `pipeline/<slug>-prd` branch; flips the row to `building`. Git is canon, Linear is a generated mirror. Idempotent (sync on re-run). Prints `gh pr create`, never runs it.                                   |
| **`/risoluto-to-issues <slug>`** | Slice a PRD into flat Linear issues (`from:prd-<slug>` label, `blocked-by` edges). Acceptance criteria must be **falsifiable behavioural assertions** (the future red test) — not a restatement of the global gate.                                                                              |
| **`/risoluto-tdd <ticket>`**     | Implement one Linear issue red-green-refactor (delegates the loop to the global `tdd` skill). Validates upstream `blocked-by` are Done; on PR-ready, back-comments the ticket with the PR URL + label and prints `gh pr create`.                                                                 |
| **`/risoluto-next-bundle`**      | The **parallel-worktree scheduler**. Filters open issues to the ready-set (every `blocked-by` is Done), then groups them into **mutually conflict-free** bundles — predicted code-locality acts as a lock so two worktrees never edit overlapping regions. Read-only; proposes, creates nothing. |

## Cross-cutting notes

- **Forks, not upgrades.** `to-prd`, `to-issues`, `tdd` are Linear-specific forks of the generic
  global `~/.claude/skills/{to-prd,to-issues,tdd}` — invoke the namespaced `risoluto-*` variants in
  this repo. The global skills stay tracker-agnostic; `grill-me`, `grill-with-docs`,
  `save-to-obsidian` are used as-is.
- **Post-merge recording is not a skill** — flipping PRD→shipped, back-commenting Linear, flipping
  the roadmap row, and refreshing `RISOLUTO_FEATURES.md` run in CI (`post-merge.yml` /
  `scripts/post-merge-prd.mjs`).
- **Two-repo model.** Skills that write under `research/` (researcher, ingest, vault, features) touch
  the submodule — commit and push the submodule **before** the parent records the new pointer.
- **Skills propose; the founder disposes** (architecture principle #9). The roadmap — not the
  research vault — is the single source of "what's next."
