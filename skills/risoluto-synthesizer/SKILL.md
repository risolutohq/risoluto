---
name: risoluto-synthesizer
description: Roll captured research targets into idea clusters for the Risoluto planning pipeline — reads every `research/targets/<slug>/README.md` and `research/targets/<slug>/sources/*.md` frontmatter `ideas:` tag, groups them by capability, and rewrites `research/ideas/<slug>/README.md` (synthesizer-owned `## Evidence`, `## Targets that ship this`, `## Variants observed`, `## Frequency` sections; operator-owned `## Analyst notes`, `## Open questions`, `## Why us / why now`, `## Smallest shippable shape` preserved verbatim) plus the `idea`-status row block in `docs/capability-backlog.md` (sticky name/category on re-runs, status field never clobbers operator-set `ready` / `in-flight` / `shipped`). Use this skill whenever Omer says `/risoluto-synthesizer`, "synthesize the research", "roll up the targets", "cluster the ideas", "regenerate the capability backlog idea rows", "rerun the synthesizer", "what ideas have ≥2 evidence targets", or any variation that implies turning captured targets into ranked idea clusters. Also trigger when Omer flags an idea as orphaned (no evidence) or asks why a backlog row flipped to `dropped` — the synthesizer is the one source of truth for `idea`-row authorship. Always runs full-corpus and is idempotent; LLM tag suggestions for thin targets (<2 ideas tagged) are flagged but gated behind operator confirmation. Companion to Phase 2.1 of `docs/planning-pipeline-roadmap.md`.
---

# risoluto-synthesizer

Idea clusterer for the Risoluto research corpus. Phase 2.1 of the planning-pipeline roadmap.

## What this skill produces

For every idea-slug that appears in any target / source `ideas:` frontmatter list:

```
research/ideas/<idea-slug>/README.md
```

And the synthesizer-owned table block in:

```
docs/capability-backlog.md   (between BEGIN/END risoluto-synthesizer:idea-rows markers)
```

Frontmatter on the idea README conforms to `research/.schemas/idea.schema.json` (Phase 1.1) and the template installed by `risoluto-vault` (Phase 1.2). The synthesizer never modifies operator-owned sections inside the idea README, never modifies the backlog status field when it's `ready` / `in-flight` / `shipped`, and never modifies any backlog row outside the marker block.

## Hard preconditions

Stop and report if any fail:

| Check                                | Command                                            | If it fails                                                                          |
| ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Run from repo root                   | `test -f package.json && test -f .gitmodules`      | Tell Omer to `cd` into the `risoluto` checkout root.                                 |
| `research/` initialised              | `git submodule status research` starts with space  | Tell Omer to `git submodule update --init research` or `/init-research`.             |
| `research/targets/` non-empty        | `ls research/targets`                              | Tell Omer to capture targets via `/risoluto-researcher` first.                       |
| `docs/capability-backlog.md` exists  | `test -f docs/capability-backlog.md`               | This file is committed at v1 — if missing, the repo is in an unexpected state.       |

## The pipeline

The synthesizer is always full-corpus: every run reads every `research/targets/*/README.md` and every `research/targets/*/sources/*.md`, then rewrites every synthesizer-owned section in every `research/ideas/*/README.md`. No incremental mode, no dirty-bit — this is what makes "idempotent" meaningful and re-runnable on any target change.

### Step 1 — Dry-run

```bash
node skills/risoluto-synthesizer/scripts/synthesize.mjs --dry-run
```

Reports per-idea actions (`WRITE` / `REPAIR` / `KEEP`), orphan detection, and any thin targets that have fewer than 2 ideas tagged. Show the plan to Omer before applying.

### Step 2 — Apply for real

```bash
node skills/risoluto-synthesizer/scripts/synthesize.mjs
```

The script:

1. Walks `research/targets/*/{README.md,sources/*.md}` and groups by idea-slug. Target-level tags populate `evidence_targets`; source-level tags populate `evidence_sources` (one hop from idea → quote).
2. For each idea with ≥1 evidence row:
   - Loads any existing `research/ideas/<slug>/README.md`.
   - Preserves frontmatter `linear_project` and `prd_file` (set by `/risoluto-to-prd` later).
   - Rewrites frontmatter `slug`, `evidence_targets`, `evidence_sources`.
   - Regenerates the `<!-- BEGIN risoluto-synthesizer -->` … `<!-- END risoluto-synthesizer -->` block with `## Evidence`, `## Targets that ship this`, `## Variants observed`, `## Frequency`.
   - Preserves everything after the END marker verbatim — those are operator-owned sections.
3. For each idea folder that exists on disk but has no current evidence (an _orphan_, usually from a tag rename): sets `evidence_targets: []`, regenerates the synth block to a "no evidence" stub, preserves operator-owned sections. The folder is never deleted.
4. Updates the backlog row block in `docs/capability-backlog.md`:
   - Active ideas get `status: idea` unless the existing row is at `ready` / `in-flight` / `shipped` (operator-set — preserved).
   - Orphan ideas get `status: dropped` unless the existing row is at an operator-set status.
   - `name` defaults to a Title Case version of the slug on first creation; sticky on re-run (operator edits never clobbered).
   - `category` defaults to `TBD`; sticky on re-run.

### Step 3 — Validate

```bash
pnpm validate:research
```

Confirms every regenerated `research/ideas/<slug>/README.md` passes `idea.schema.json`. Schema failures usually mean an upstream target/source has malformed `ideas:` frontmatter — fix the source, re-run the synthesizer.

### Step 4 — LLM tag suggestions for thin targets

When the script reports thin targets (`<2 ideas tagged`), the agent's job is to:

1. Read each thin target's `README.md` and `sources/*.md` body.
2. Propose 1–3 candidate idea slugs that match the existing corpus naming convention (lowercase-hyphenated, capability-shaped — e.g. `multi-agent-orchestration`, `cost-ceiling`, not `the-cool-feature`).
3. Show the proposals to Omer **before** writing anything.
4. Only after operator confirmation: add the approved slugs to the target/source frontmatter `ideas:` lists, then re-run `node skills/risoluto-synthesizer/scripts/synthesize.mjs`.

Do not auto-add tags. The thin-target signal is intentional friction so the operator stays in the loop on taxonomy growth.

### Step 4.5 — Category drafting for newly-created `idea` rows

The script seeds new backlog rows with `name = TitleCase(slug)` and `category = TBD`. The agent must follow up on every fresh `TBD` (search the `BEGIN risoluto-synthesizer:idea-rows` block in `docs/capability-backlog.md`):

1. For each `TBD` row, read `research/ideas/<slug>/README.md` and the cited target / source files.
2. Pick a category from the canonical list in `docs/capability-backlog.md` (`Workflow Definitions`, `Tracker Adapters`, `Harness Adapters`, `Memory Manager`, `Board Projection`, `Operator Surfaces`, `Cost / Reliability`, `Plugin API`, `Hosted Modes`, `Skill Packs`). Do not invent new categories — the bucket list is the contract.
3. Refine `name` if the title-cased slug fumbles an acronym (`mcp` → `MCP`, `cli-reviewer` → `CLI Reviewer`, `dual-sdk` → `Dual SDK`). The script writes a plain Title Case default; the agent owns acronym polishing.
4. Edit `docs/capability-backlog.md` directly inside the marker block — the sticky merge preserves operator-set `name` and `category` on every subsequent `synthesize.mjs` run, so this edit only happens once per new row.

Show the proposed mapping to Omer **before** writing. Don't auto-categorize silently — the categorization step is where the backlog gets its meaning, and it deserves the same gate as the thin-target tag suggestions in Step 4.

### Step 5 — Commit

The synthesizer writes into two repos at once: `research/` (submodule, for `research/ideas/`) and the parent repo (for `docs/capability-backlog.md`). Commit submodule first:

```bash
cd research
git add ideas/
git commit -m "research: synthesize idea clusters"
git push
cd ..
git add research docs/capability-backlog.md
git commit -m "chore: bump research submodule + sync backlog rows from synthesizer"
```

## Idea README ownership (what the script touches on re-runs)

| Section / Field                             | Behaviour                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Frontmatter `slug`                          | Regenerated every run from the folder name.                                                 |
| Frontmatter `evidence_targets`              | Regenerated every run from target `ideas:` frontmatter.                                     |
| Frontmatter `evidence_sources`              | Regenerated every run from source `ideas:` frontmatter.                                     |
| Frontmatter `linear_project`, `prd_file`    | Preserved verbatim — set by `/risoluto-to-prd` (Phase 3.2).                                 |
| `## Evidence`                               | Synthesizer-owned — regenerated every run.                                                 |
| `## Targets that ship this`                 | Synthesizer-owned — regenerated every run.                                                 |
| `## Variants observed`                      | Synthesizer-owned — regenerated as a deterministic skeleton. LLM enrichment belongs in `## Analyst notes`. |
| `## Frequency`                              | Synthesizer-owned — regenerated every run.                                                 |
| `## Analyst notes`                          | Operator-owned — preserved verbatim.                                                       |
| `## Open questions`                         | Operator-owned — preserved verbatim.                                                       |
| `## Why us / why now`                       | Operator-owned — filled by `/risoluto-grill` (Phase 3.1).                                  |
| `## Smallest shippable shape`               | Operator-owned — filled by `/risoluto-grill` (Phase 3.1).                                  |

## Backlog row ownership

| Column          | Behaviour                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `slug`          | Synthesizer-owned — regenerated every run.                                                         |
| `name`          | Synthesizer script drafts `TitleCase(slug)`; agent polishes acronyms on first creation (see Step 4.5); operator edits are sticky on re-run. |
| `category`      | Synthesizer script drafts `TBD`; agent fills from the canonical category list on first creation (see Step 4.5); operator edits sticky on re-run. |
| `status`        | Synthesizer writes `idea` (active) or `dropped` (orphan); preserved if operator has set `ready` / `in-flight` / `shipped`. |
| `evidence_idea` | Synthesizer-owned — always `research/ideas/<slug>/README.md`.                                       |

The script only ever touches the rows inside `<!-- BEGIN risoluto-synthesizer:idea-rows -->` / `<!-- END risoluto-synthesizer:idea-rows -->`. Hand-written rows outside the block are untouched.

## Smoke test

The repo currently has three captured targets: `composio`, `magpie`, `agent-orchestrator`. `composio` and `magpie` both tag `provider-abstraction`. Running the synthesizer:

```bash
node skills/risoluto-synthesizer/scripts/synthesize.mjs --dry-run
node skills/risoluto-synthesizer/scripts/synthesize.mjs
pnpm validate:research
```

Expected output:

- `research/ideas/provider-abstraction/README.md` exists with `evidence_targets: [composio, magpie]` and `evidence_sources` pointing to both source files.
- Re-running the script with no other changes prints `KEEP` for every idea and `unchanged` for the backlog.
- `docs/capability-backlog.md` has a `| provider-abstraction | Provider Abstraction | TBD | idea | research/ideas/provider-abstraction/README.md |` row inside the marker block.
- `pnpm validate:research` reports all files OK.

## Why this skill is separate from `risoluto-researcher`

The researcher (Phase 1.3) writes _per-target_ artifacts from individual URLs — it doesn't know what overlaps with what. The synthesizer (Phase 2.1) does the cross-target reduction. Keeping them separate makes both idempotent and lets the synthesizer be re-run any time a target's `ideas:` list changes without re-fetching anything.

## Eval scaffolding

`evals/evals.json` holds trigger-test prompts for the description. Run skill-creator's `run_loop.py` to benchmark and tighten the description's triggering accuracy:

```bash
python -m scripts.run_loop \
  --eval-set skills/risoluto-synthesizer/evals/evals.json \
  --skill-path skills/risoluto-synthesizer \
  --model <current-model-id> \
  --max-iterations 5 \
  --verbose
```

(Run from the skill-creator root, not the risoluto root.)
