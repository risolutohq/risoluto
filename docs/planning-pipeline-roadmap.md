# Planning Pipeline Roadmap

> Living document. Captures the design tree resolved in the grill session of 2026-05-26.
> Authoritative until superseded by `docs/adr/0007-research-to-shipping-pipeline.md` (Phase 5).
>
> Companion reading: [planning-pipeline-workflow.md](./planning-pipeline-workflow.md) (build/review prompts for driving this roadmap session-by-session), [research-workflow.md](./research-workflow.md), [capability-backlog.md](./capability-backlog.md), [decisions.md](./decisions.md).

---

## TL;DR — The Loop

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
                                                               └─→ Linear Issues (flat, blocked-by relations)
                                                                    └─→ /tdd <linear-ticket-ref>
                                                                         └─→ PR (back-comment to Linear)
```

**Two stages, one seam:**

- **Planning** (heavy): researcher → synthesizer → grill → PRD → issues. Mostly text and decisions.
- **Implementation** (lighter): tdd loop per ticket. Linear ticket is the unit.

---

## Preflight

Before starting work on any phase, verify the following. Each item is one command or env var; failing means stop and resolve first.

- **`research/` submodule initialized** — `git submodule status research` returns a line starting with a space (not `-`). If missing: run `/init-research`.
- **Linear MCP configured** (Phase 3+) — Claude Code MCP config has a `linear` server with API key. Verify with a `mcp__linear__*` tool call.
- **Husky present** — `.husky/pre-push` exists and is executable. Already true in this repo.
- **`semantic-release` config untouched** — `.releaserc.yml` exists; Conventional Commits enforcement via `commitlint` is active.
- **OpenCode CLI + GitHub Actions secret** (Phase 4.3) — `OPENCODE_*` secrets configured in the repo for the post-merge workflow.

---

## Resolved Design Decisions

| #   | Decision                                                                             | Q   |
| --- | ------------------------------------------------------------------------------------ | --- |
| P1  | Research organized **per-target** (`research/targets/<slug>/`)                       | Q1  |
| P2  | `research/` becomes a **scoped Obsidian vault**, configured by a new skill           | Q2  |
| P3  | Always-folder shape: `targets/<slug>/README.md` + `targets/<slug>/sources/*.md`      | Q3  |
| P4  | **Two separate vaults** — `~/Documents/my-vault/` stays; `research/` is independent  | Q4  |
| P5  | Synthesizer writes both `research/ideas/<slug>/` **and** `capability-backlog.md`     | Q5  |
| P6  | New **`risoluto-grill`** skill; `grill-me` / `grill-with-docs` stay generic          | Q6  |
| P7  | Synthesizer runs **at any corpus size**; **tag-anchored + LLM-suggested** clusters   | Q7  |
| P8  | PRD lives canonically in **`docs/prds/<slug>.md`** (git) → pushed to Linear Project  | Q8  |
| P9  | Linear via **MCP**; **flat issues + blocked-by** relations; **no GitHub mirror** yet | Q9  |
| P10 | **Manual `/tdd <ticket-ref>`** now; runtime auto-pickup deferred                     | Q10 |

These resolve, refine, or extend the following existing decisions: #6 (Linear canonical for planning — _refined_: prose lives in git, Linear holds tickets+status), #15 (Linear-triggered dogfood — _extended_: manual `/tdd` is the bootstrap dogfood).

---

## Frontmatter Contract (the API of the pipeline)

This contract is the joint between every skill. JSON Schemas to live under `research/.schemas/`.

**Slug collisions:** slugs are namespaced by type — `targets/<slug>/` and `ideas/<slug>/` can share the same string (they live in different folders). _Within_ a namespace, the synthesizer/researcher refuse to create a duplicate and halt with `slug "<x>" already exists — rename one before proceeding`. Operator renames in source, re-runs.

### `research/targets/<slug>/sources/<source-slug>.md`

```yaml
target: <target-slug> # which target this source describes
source_type: article|reddit|x|repo|video|paper|talk
url: https://...
captured_at: 2026-05-26
captured_by: risoluto-researcher|web-clipper|manual
ideas: [multi-agent-orchestration, cost-ceiling] # may be empty at capture
```

### `research/targets/<slug>/README.md`

```yaml
slug: <target-slug>
canonical_url: https://...
category: peer|reference|adjacent
last_researched_at: 2026-05-26
last_researched_sha: <git-sha or content-hash>
ideas: [...] # union of sources/*.md ideas
source_count: <int>
```

### `research/ideas/<slug>/README.md`

Status lives canonically in `capability-backlog.md` — the idea README never duplicates it. The `slug` is the join key (folder name, frontmatter field, and the backlog row's `slug` column), so no line-number pointers.

```yaml
slug: <idea-slug> # primary key — folder name + capability-backlog.md row's slug column
evidence_targets: [cursor, aider, ...] # which targets ship this
evidence_sources: # source-level pointers — one hop from idea to the quote that earned the tag
  - targets/cursor/sources/multi-agent-thread.md
  - targets/aider/sources/architect-mode.md
linear_project: PRO-xxx # set when to-prd runs; else null
prd_file: docs/prds/<slug>.md # set when to-prd runs; else null
```

### `docs/prds/<slug>.md`

```yaml
slug: <slug>
linear_project: PRO-xxx
synced_at: 2026-05-26T...
source_idea: research/ideas/<slug>/README.md
status: draft|approved|shipped|archived
```

---

## Ownership Rules (synthesizer vs operator)

Synthesizer / skill-owned sections are **regenerated** on every run. Operator-owned sections **evolve forward** — never clobbered. Same pattern as `risoluto-features`.

### `research/ideas/<slug>/README.md` sections

| Section                       | Owner                                  |
| ----------------------------- | -------------------------------------- |
| `## Evidence`                 | synthesizer                            |
| `## Targets that ship this`   | synthesizer                            |
| `## Variants observed`        | synthesizer                            |
| `## Frequency`                | synthesizer                            |
| `## Analyst notes`            | operator                               |
| `## Open questions`           | operator                               |
| `## Why us / why now`         | operator (filled by `/risoluto-grill`) |
| `## Smallest shippable shape` | operator (filled by `/risoluto-grill`) |

### `research/targets/<slug>/README.md` fields

| Field                                            | Owner      |
| ------------------------------------------------ | ---------- |
| `slug`, `canonical_url`, `category`              | operator   |
| `last_researched_at`, `last_researched_sha`      | researcher |
| `ideas` (union of `sources/*.md` `ideas:` lists) | researcher |
| `source_count` (glob of `sources/*.md`)          | researcher |

### `capability-backlog.md` rows

| Field / status                        | Owner                                                           |
| ------------------------------------- | --------------------------------------------------------------- |
| `slug`, `evidence_idea`               | synthesizer (regenerated every run)                             |
| `name`, `category`                    | synthesizer drafts on first creation; operator-sticky on re-run |
| status: `idea`                        | synthesizer (created/updated)                                   |
| status: `ready / in-flight / shipped` | operator                                                        |
| status: `dropped`                     | operator OR synthesizer (orphan handling — see Phase 2.1)       |

---

## Build Phases

Each phase is independently shippable and dogfoodable. Don't build phase N+1 before phase N produces real artifacts. **Skill subtasks (anything under `skills/risoluto-*/`) must be scaffolded with `/skill-creator`** — never hand-rolled. See [planning-pipeline-workflow.md](./planning-pipeline-workflow.md) for the build/review prompt pattern used to drive these phases across sessions.

### Phase 1 — Foundation _(completed 2026-05-26, 87f4613)_

Goal: capture targets, write the contract, scope the vault.

- [x] **1.1** Finalize frontmatter contract under `research/.schemas/`: _(9f6f84b + research submodule b8a7103)_
  - `source.schema.json`, `target.schema.json`, `idea.schema.json`
  - Set `additionalProperties: true` on every schema. The vault is also an Obsidian vault — Web Clipper, Templater, and the operator will inject fields (`tags:`, `aliases:`, plugin-specific keys). Schemas validate the pipeline-owned subset only; everything else passes through untouched.
  - Tiny `pnpm validate:research` script that walks the corpus and validates every file.
- [x] **1.2** Build `skills/risoluto-vault/` (new skill): _(fc63d67)_
  - Writes `research/.obsidian/{app,appearance,core-plugins,community-plugins}.json`
  - Forces relative-markdown-links (no wikilinks), commits the config
  - Installs templates: `templates/source.md`, `templates/target-readme.md`, `templates/idea-readme.md`
  - Pre-canned Dataview queries: "untagged sources", "ideas with <2 evidence targets", "targets not refreshed in 90d"
  - Pinned plugins: Web Clipper, Dataview, Templater (no others). **First-run is not one-shot:** community plugins can't be installed from JSON config alone — the operator opens the vault in Obsidian once and installs them via the UI, then the skill's `community-plugins.json` pins the active list. Skill detects missing plugins and prints the install commands to run.
  - Idempotent — re-run repairs drift (after the first-run manual seed)
  - **Smoke:** given a fresh `research/` submodule, writes `.obsidian/` config + `templates/` + Dataview queries. Re-running on an already-configured vault repairs drift without overwriting operator preferences.
- [x] **1.3** Build `skills/risoluto-researcher/` (new — does not exist yet, despite earlier "upgrade" framing): _(aa5284c)_
  - Accept raw paste + URL (provenance), not just URLs
  - Write to `research/targets/<slug>/README.md` (folder shape, not flat `<slug>.md`)
  - Write raw captured material to `research/targets/<slug>/sources/<source-slug>.md` with frontmatter
  - Create `research/INDEX.md` (does not exist yet) — folder-shaped target list, regenerated on every researcher run. INDEX.md stays even after the vault is in place: Dataview is for opening in Obsidian, INDEX.md is for agents, CI, `cat`, and `git log`.
  - Researcher emits markdown that conforms to the templates installed by `risoluto-vault` (1.2). Templates and skill share the same frontmatter contract — if you change one, change both.
  - **Smoke:** given one URL, produces a target README + one source file that pass `pnpm validate:research`.
- [x] **1.4** Update `docs/research-workflow.md`: _(df6d77d)_
  - Remove 20-target deferral on synthesizer
  - Document the frontmatter contract
  - Document vault overlay and PRD inversion
  - Note: no GitHub mirror for now

**Exit criterion:** `pnpm validate:research` passes on a corpus of ≥3 captured targets.

**Rollback:** drop `skills/risoluto-vault/` and `skills/risoluto-researcher/`, delete `research/.schemas/`, remove the `validate:research` entry from `package.json`. The `.obsidian/` config in `research/` can stay (harmless if no one opens the vault) or be reverted with `git checkout HEAD~ -- research/.obsidian`.

### Phase 2 — Synthesis _(completed 2026-05-26, 5713df8)_

Goal: turn captured targets into idea clusters.

- [x] **2.1** Build `skills/risoluto-synthesizer/`: _(3ec924d + research submodule 68fb89c)_
  - Reads `research/targets/*/README.md` frontmatter `ideas:`
  - Rolls up by tag → writes `research/ideas/<slug>/README.md`
  - LLM-suggests new tags **only** when a target has <2 ideas tagged; gates suggestions behind operator confirmation
  - Synthesizer-owned vs operator-owned section discipline (see ownership table)
  - Updates `capability-backlog.md` `idea`-status rows; never touches other statuses
  - Always full-corpus: every run reads every `targets/*/README.md` and rewrites every synthesizer-owned section in every `ideas/*/README.md`. No incremental mode, no dirty-bit. This is what makes "idempotent" meaningful and re-runnable on any target change.
  - **Orphan handling:** ideas whose evidence drops to zero are not deleted. Synthesizer sets `evidence_targets: []` in the idea README frontmatter and flips the matching backlog row to `dropped` (reason: `no evidence in corpus`). Operator-owned sections (`## Analyst notes`, `## Open questions`, `## Why us / why now`, `## Smallest shippable shape`) are preserved verbatim. Re-tagging any target revives the idea automatically on the next run.
  - **Smoke:** given two targets sharing tag `X`, produces `ideas/X/README.md` with `evidence_targets: [target1, target2]` and a matching `idea`-status backlog row.
- [x] **2.2** Update `docs/capability-backlog.md`: _(3ec924d + 5713df8)_
  - Backlog is currently status-vocabulary + empty "Initial Entries" — design and document the row schema before the synthesizer writes the first entry
  - Schema: `slug` (join key to `research/ideas/<slug>/`), `name`, `category` (from the existing Categories list), `status`, `evidence_idea` (path to `research/ideas/<slug>/README.md`)
  - **Row authorship:** on first creation of an `idea`-status row, the synthesizer LLM-drafts `name` and `category` from the idea README. On subsequent runs, the synthesizer rewrites only `slug` and `evidence_idea` — operator edits to `name` and `category` are sticky. Status field follows the ownership table above.
  - Document how synthesizer writes `idea` rows (template, link convention)
  - **Discovery surface:** `capability-backlog.md` is the canonical place to scan and pick ideas. `research/INDEX.md` and the vault Dataview view are complementary views, not entry points. Phrase this explicitly in the file's preamble so agents don't go fishing elsewhere.
- [x] **2.3** Dogfood: capture 3–5 real targets via `/risoluto-researcher`, then run `/risoluto-synthesizer`. Confirm ≥1 idea emerges with evidence from ≥2 targets. _(87f4613 capture sprint + 3ec924d synthesize; `provider-abstraction` evidences `[composio, magpie]`)_ **Note:** for this first dogfood, pick targets known to overlap on at least one capability (e.g. two coding-agent frameworks with similar feature shapes). Random sampling will produce zero clusters and block the exit.

**Exit criterion:** at least one `research/ideas/<slug>/README.md` exists with synthesizer-owned sections populated and operator-owned sections empty-but-templated.

**Rollback:** drop `skills/risoluto-synthesizer/` and revert the row-schema section of `docs/capability-backlog.md`. Leave `research/ideas/` in place — without the synthesizer they're harmless static notes, and the operator may want to keep what was already grilled.

### Phase 3 — Grilling & PRD

Goal: take an idea from "interesting cluster" to "Linear Project + greppable PRD".

- [x] **3.1** Build `skills/risoluto-grill/`: _(cc76686)_
  - Input: `<idea-slug>` or path to `research/ideas/<slug>/README.md`
  - Pre-loads: idea README, every cited target's README, relevant `RISOLUTO_FEATURES.md` bundles, `capability-backlog.md`
  - Runs grill loop framed for the research→product seam: "you have N peers doing X, why us, why now, smallest cut"
  - On exit: writes `## Why us / why now` and `## Smallest shippable shape` into the idea README; offers to flip backlog status `idea → ready`
  - **Smoke:** given an `<idea-slug>`, runs the grill loop and writes `## Why us / why now` and `## Smallest shippable shape` into the idea README. Idempotent — re-running re-grills, operator keeps iterating.
- [ ] **3.1.5** Operator runs `/grill-with-docs` (generic, unchanged) between `/risoluto-grill` and `/to-prd` whenever the idea touches existing docs/ADRs. Output: updated `docs/*.md` and/or a new ADR under `docs/adr/`. No new skill — this step exists only so the TL;DR loop maps to the build phases.
- [ ] **3.2** Fork `~/.claude/skills/to-prd/` to `skills/risoluto-to-prd/` (keep the global skill generic):
  - Switch to Linear MCP transport
  - Write `docs/prds/<slug>.md` with frontmatter (`linear_project`, `source_idea`, `synced_at`, `status`)
  - Create matching Linear Project; description = PRD body
  - Open PR for the new PRD file
  - Update the idea's `linear_project` + `prd_file` frontmatter
  - **Idempotent on re-run.** First invocation on a slug creates the Linear Project + PRD. Subsequent invocations on the same slug overwrite the Linear Project description from the current `docs/prds/<slug>.md` — this is the git→Linear push path used by 3.3's "reject the Linear edit" branch. The skill decides mode from the idea README's `linear_project` frontmatter (null = create, set = sync). No new pnpm command needed.
  - **Smoke:** given an idea slug with `## Why us / why now` populated, creates `docs/prds/<slug>.md` and a matching Linear Project. Second run on the same slug overwrites the Linear description from the current PRD without re-creating the Project.
- [ ] **3.3** Husky `pre-push` hook + reconcile path:
  - Diff every changed `docs/prds/*.md` HEAD vs the Linear Project description via MCP
  - Refuse push if Linear has been edited outside the git canonical path
  - **Carved out of `SKIP_HOOKS=1`:** the existing pre-push emergency bypass skips build/test/typecheck. The PRD drift check runs unconditionally — it's cheap (one MCP call per changed PRD file), and a silent canon-drift is worse than a blocked push. Single small `if`-block in `.husky/pre-push` enforces this.
  - Same check runs as a GitHub Action on PR for redundancy
  - **Two unblock paths**, depending on which side is canon:
    - _Adopt the Linear edit_ (Linear is right): `pnpm prd:reconcile <slug>` pulls the Linear description back into `docs/prds/<slug>.md` and opens a PR. Operator merges to accept.
    - _Reject the Linear edit_ (git is right): re-run `/risoluto-to-prd <slug>` — the skill is idempotent (see 3.2) and overwrites the Linear Project description from the current PRD. No new pnpm command.
  - Hook stays a hard gate — no `--no-verify` escape hatch.
- [ ] **3.4** Create `docs/prds/README.md`:
  - Explain: PRDs are canonical in git; Linear Project description is a generated mirror
  - "To edit a PRD, open a PR against `docs/prds/<slug>.md`"
  - Linear UI banner template to paste into Project descriptions
  - **Operator discipline:** do not edit Linear Project descriptions in the UI. The drift hook is intentional friction — treat the Linear description as generated content. `pnpm prd:reconcile` exists to _adopt_ an accidental UI edit, not as a sanctioned edit path.

**Exit criterion:** one full PRD lives at `docs/prds/<slug>.md` with a matching Linear Project, and `pre-push` hook blocks a synthetic drift scenario.

**Rollback:** drop `skills/risoluto-grill/` and `skills/risoluto-to-prd/`, remove the PRD-diff block from `.husky/pre-push` and delete the matching GitHub Action, remove `pnpm prd:reconcile` from `package.json`, delete `docs/prds/`. Linear Projects already created become orphans — operator either archives them in Linear or leaves them as historical record.

### Phase 4 — Tickets & Implementation

Goal: PRD → Linear Issues → PR loop.

- [ ] **4.1** Fork `~/.claude/skills/to-issues/` to `skills/risoluto-to-issues/`:
  - Linear MCP only
  - Resolve target Project from PRD frontmatter `linear_project`
  - **Slice graph source:** the skill reads the full PRD body and uses an LLM pass to extract slices and their dependencies (no explicit `## Slices` section required). Non-deterministic — the same PRD may produce slightly different graphs on different runs. Operator reviews the proposed graph before issues are created; rejecting the proposal re-runs the inference with feedback.
  - Create flat Issues with Linear "blocked-by" relations driven by the inferred slice graph
  - Apply labels: `bundle:<x>` (categories from `capability-backlog.md`), `tracer`, `slice:hitl` | `slice:afk`, `from:prd-<slug>`
  - **Smoke:** given a PRD slug, extracts slices via LLM, presents them for operator review, then creates flat Linear Issues with `blocked-by` relations matching the approved graph.
- [ ] **4.2** Fork `~/.claude/skills/tdd/` to `skills/risoluto-tdd/`:
  - Accept `<ticket-ref>` arg (e.g. `RSL-123`)
  - Fetch issue + linked PRD via MCP
  - Validate upstream blocked-by tickets are status: Done
  - On PR open, comment Linear ticket with PR URL, and apply the `from:prd-<slug>` label to the PR so the post-merge workflow (4.3) can find the linked PRD
  - **Smoke:** given a Linear ticket ref with all blocked-by tickets at status Done, opens a PR linked to the ticket, applies the `from:prd-<slug>` label, and back-comments the PR URL.
- [ ] **4.3** Post-merge automation — first LLM-driven dogfood:
  - Ship `.github/workflows/post-merge.yml` that fires on `pull_request.closed && merged == true` for any PR labeled `from:prd-<slug>`
  - Workflow invokes an OpenCode agent with a scoped prompt: "find the linked PRD from the PR's `from:prd-*` label, flip frontmatter `status: shipped`, back-comment the Linear ticket with the merged PR URL, commit changes to `main`."
  - This is the first place Risoluto-flavored runtime work runs in CI. Same workflow grows future post-merge behaviors (changelog updates, Linear archival, etc.) without rewriting the YAML — just extending the prompt.
  - **Cost / determinism tradeoff:** one OpenCode run per merged PR. Accepted vs deterministic YAML (`yq` + `gh` + `regex`) because the second post-merge behavior amortizes the investment, and the runtime dogfood is itself part of the product story.
  - **Smoke:** given a synthetic merged PR with a `from:prd-<slug>` label, the workflow flips the matching PRD's `status` to `shipped` and posts the merged URL back to the Linear ticket.

**Exit criterion:** one Linear Issue created from `to-issues` is picked up by `/tdd`, produces a merged PR, the Linear ticket has the PR back-comment, and the linked PRD's frontmatter `status` flips to `shipped` via the post-merge workflow.

**Rollback:** drop `skills/risoluto-to-issues/` and `skills/risoluto-tdd/`, remove `.github/workflows/post-merge.yml`. Existing Linear Issues stay (and any merged PRs stay merged) — they just stop receiving back-comments, stop being created from PRDs, and stop auto-flipping PRD status.

### Phase 5 — Record

Goal: write down what we built so the next operator (or future you) doesn't re-derive it.

- [ ] **5.1** Write `docs/adr/0007-research-to-shipping-pipeline.md`:
  - Status: active
  - Context: how Risoluto's planning surface evolves from raw research to shipping PRs
  - Decision: this roadmap, with the resolved table from above
  - Consequences: the seam between planning and runtime is the Linear ticket, not the harness
- [ ] **5.2** Append a row to `docs/decisions.md` referencing the ADR
- [ ] **5.3** Mark this file (`planning-pipeline-roadmap.md`) as superseded-by ADR-0007

**Rollback:** records don't get deleted. If the decision reverses, write a new superseding ADR (0008+) and update the status of 0007 to `superseded-by`. This file stays.

---

## Skill Inventory (final state)

After all phases ship, the workspace and global skill layout is:

| Skill                        | Location                             | Status                      |
| ---------------------------- | ------------------------------------ | --------------------------- |
| `risoluto-features`          | `skills/risoluto-features/`          | existing, unchanged         |
| `risoluto-researcher`        | `skills/risoluto-researcher/`        | **new** in 1.3              |
| `risoluto-vault`             | `skills/risoluto-vault/`             | **new** in 1.2              |
| `risoluto-synthesizer`       | `skills/risoluto-synthesizer/`       | **new** in 2.1              |
| `risoluto-grill`             | `skills/risoluto-grill/`             | **new** in 3.1              |
| `to-prd` (Linear variant)    | `skills/risoluto-to-prd/` (fork)     | **new fork** in 3.2         |
| `to-issues` (Linear variant) | `skills/risoluto-to-issues/` (fork)  | **new fork** in 4.1         |
| `tdd` (Linear-aware)         | `skills/risoluto-tdd/` (fork)        | **new fork** in 4.2         |
| `grill-me`                   | `~/.claude/skills/grill-me/`         | unchanged (generic)         |
| `grill-with-docs`            | `~/.claude/skills/grill-with-docs/`  | unchanged (generic)         |
| `save-to-obsidian`           | `~/.claude/skills/save-to-obsidian/` | unchanged (different vault) |

**Fork-not-upgrade rule:** Linear-specific behavior lives in `skills/risoluto-*/`; the global `~/.claude/skills/{to-prd,to-issues,tdd}` stay generic and reusable across non-Risoluto projects.

---

## What This Roadmap Is Not

- A v2/v3 roadmap. There's no plan for synthesizer marketplace, hosted modes, plugin API. Those belong in `capability-backlog.md` once the planning loop is shipped and starts surfacing them.
- A runtime spec. The Risoluto runtime that auto-consumes Linear tickets is a separate workstream; this roadmap stops at "manual `/tdd <ticket-ref>` works end-to-end." Auto-pickup is parked behind the `auto:runtime` label seam.
- A bidirectional Linear ↔ git sync. Only two flows ship in this roadmap: (a) git → Linear on `to-prd` / `to-issues` create, and (b) PR → Linear back-comment on PR open. Linear → git for issue state changes (review, merge, close), Linear comments → git, and Linear assignee/label edits are **deferred**. The PRD drift hook (3.3) is the only Linear-watching surface; everything else assumes the operator reads Linear in the Linear UI.
- A schedule. No dates. Phases are gated by exit criteria, not calendar.
