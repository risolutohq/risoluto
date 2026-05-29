---
name: risoluto-grill
description: Critic-grill for the Risoluto research pipeline (Mode A). Takes a source's post-dedup candidate features from research/targets/<slug>/README.md and, for each surviving candidate (dedup flag new/merge/supersede), runs a grill loop that challenges fit-vs-spine, differentiation ("N peers ship X — why us, why now?"), and the thinnest shippable cut. The founder decides in/out per candidate. Kept candidates are written as roadmap rows (status idea or next) in docs/roadmap.md whose Research link points back to research/targets/<slug>/README.md. Use this skill whenever Omer says /risoluto-grill, "grill the <slug> candidates", "critique these candidate features", "triage <slug> into the roadmap", "which of these candidates should become roadmap rows", or any variation that implies stress-testing post-dedup candidates from a research target and deciding which ones earn a roadmap row.
---

# risoluto-grill

Critic-grill for Mode A of the Risoluto research-to-shipping pipeline. Receives a research target's post-dedup candidate features and stress-tests each one until the founder decides in or out. Kept candidates become roadmap rows in `docs/roadmap.md`.

## Role in the pipeline

```
/risoluto-researcher
  writes research/targets/<slug>/README.md
    ## Candidate features   ← each carries a dedup flag
      skip      = already shipped or covered → dropped, not grilled
      merge     = folds into existing roadmap row → update that row, not a new one
      supersede = replaces an existing row → mark old superseded, add new row
      new       = no overlap → proceeds to the grill loop here
  ↓
/risoluto-grill  (this skill)
  grills each surviving candidate (new / merge / supersede)
  founder decides in / out per candidate
  kept candidates → roadmap rows in docs/roadmap.md
  ↓
founder ranks the rows
  ↓
next rows enter the shared back-half
  /risoluto-to-prd → /risoluto-to-issues → /risoluto-tdd → merge
```

The skill is **interactive**: one question at a time, wait for the founder's answer, continue.

## What this skill produces

For one research target at a time, this skill drives a grilling conversation and appends or edits rows in `docs/roadmap.md`:

```
docs/roadmap.md
  | # | Item | Why now | Size | Status | Research link |
  ← new rows appended (status: idea or next)
  ← existing rows edited only for merge / supersede candidates
```

Nothing is written to `research/targets/` — that directory is read-only from this skill's perspective. Nothing is written to any other file.

## Hard preconditions

Stop and report if any fail:

| Check                    | Command                                           | If it fails                                                                  |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Run from repo root       | `test -f package.json && test -f .gitmodules`     | Tell Omer to `cd` into the `risoluto` checkout root.                         |
| `research/` initialised  | `git submodule status research` starts with space | Tell Omer to run `git submodule update --init research` or `/init-research`. |
| Target README exists     | `test -f research/targets/<slug>/README.md`       | Tell Omer to run `/risoluto-researcher` on that source first.                |
| `docs/roadmap.md` exists | `test -f docs/roadmap.md`                         | This file is committed — if missing, the repo is in an unexpected state.     |

## The pipeline

The skill is three steps: **preload**, **grill**, **write**. The grill (the conversation itself) happens in the agent's context — the scripts handle deterministic context gathering and the final roadmap write so re-runs are idempotent.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-grill/scripts/preload.mjs <target-slug>
```

The script prints, to stdout, a JSON manifest listing every file the agent should read before opening the grill:

- `research/targets/<slug>/README.md` (the source's candidates and dedup flags).
- `docs/roadmap.md` (the authoritative ranked plan — needed to place new rows correctly and to find rows targeted by merge/supersede candidates).
- `research/RISOLUTO_FEATURES.md` (already-shipped features — the strongest "why us" anchor when challenging differentiation).

The script prints paths only; it does not read files itself. The agent then reads those files into context. Show Omer a one-line summary ("loaded target with N surviving candidates, roadmap has M rows, K features-spine hits") before grilling — do not dump raw file contents.

**Phase 2 note:** `preload.mjs` will be rewired to parse the `## Candidate features` section of the target README, extract each candidate with its dedup flag, and emit structured JSON so the grill loop can iterate candidates cleanly. The intended output shape is `{ candidates: [{ title, flag, summary }], roadmap_rows: [...], features_spine: [...] }`. Do not implement this yet — describe the intent here for reference.

### Step 2 — Grill each surviving candidate

For each candidate whose dedup flag is `new`, `merge`, or `supersede` (skip `skip` candidates entirely), open a grill loop. Process candidates one at a time — finish each grill and get the founder's in/out decision before moving to the next.

Open the loop by stating the candidate's title and one-sentence summary from the target README. Then ask **one question at a time** and wait for the founder's answer before continuing.

The grill is a **research→product** stress test. The corpus has already shown what peers ship. The founder's job is to defend (or kill) Risoluto's right to ship the same capability. Drive toward four crisp answers:

1. **Job served & alignment** — which of the five AFK jobs (`docs/product-spine.md` → "The jobs Risoluto exists to serve") does this deepen: observability/trust, failure recovery, cost control, coordination/parallelism, or review/handoff? If it maps to none — or only to a job Risoluto deliberately defers (`product-spine.md` → "What v1 does not implement") — that is a kill signal, not a caveat.
2. **Fit-vs-spine** — does this candidate compose with Risoluto's existing primitives (workflow runs, tracker adapters, harness adapters, DAG/state-machine) or does it require a net-new primitive? Quote the relevant shipped features from `RISOLUTO_FEATURES.md`.
3. **Right to ship** — _class-dependent_ (the classification router below decides which question applies). For a `differentiator`: "N peers ship X — why us, why now, what is our structural or timing edge?" For `table_stakes`: "N peers ship X — its absence is a hole; what is the cheapest credible version?"
4. **Thinnest shippable cut** — expressed against the spine: the smallest tracer that proves the bet end-to-end and could land in one or two PRs.

Branches to walk, in order, one question at a time:

1. **Job & value** — "Which of the five AFK jobs does this serve, and what evidence is there that _Risoluto's_ operator has that need — not just that a peer shipped it?" If no job maps, stop here: the candidate is out.
2. **Peer landscape** — "Of the peers cited in the target README, which is the strongest? Which is closest in shape to what you'd build in Risoluto?" Quote the bullets from the pre-loaded README.
3. **Spine fit** — "The spine ships [cite matching RISOLUTO_FEATURES entries]. Does this candidate compose with those, or does it require a new primitive? If a new primitive, name it."
4. **Timing** — "Why now and not 6 months ago or 6 months from now? What changed in the corpus, in the platform, or in your workflow that makes this the next bet?"
5. **Failure mode** — "What does this look like at month 6 if it ships and nobody uses it? What is the kill-condition?"
6. **Thinnest cut** — "If you had one Linear ticket today as the tracer, what does it do? What does it explicitly not do?"
7. **Open edge** — "What is still uncertain? These go into the roadmap row's Why now cell as a caveat — the grill doesn't resolve everything, but unresolved bets must be named."

If the founder stalls or contradicts something in the pre-loaded corpus, surface it directly: "The target README quotes [peer] shipping X — your answer assumes Risoluto already has Y. Which is true?"

### Admission logic — two gates, a router, two ordering-only scores

This is **not** a weighted score. A strong number on one axis must never outvote a failed gate — that would re-admit the shiny objects the grill exists to kill. Resolve each candidate in this order; the **first gate it fails ends the grill with "out."**

**Gate 1 — Thesis alignment (hard).** Does it deepen one of the five AFK jobs (`product-spine.md` → "The jobs Risoluto exists to serve"), and not one Risoluto deliberately defers (`product-spine.md` → "What v1 does not implement")? No named job → **dropped**. This is cite-or-drop — the same grammar as Mode B's idea gate and the roadmap's "no Why now → no `next`." A candidate with no job is not scored low; it is dropped.

**Router — Classification.** Tag the survivor `differentiator` | `table_stakes` | `nice_to_have`. This is **not** a scoring axis — it _selects which justification standard the candidate must clear_ at Gate 2. (Summing a differentiator and a table-stakes on one numeric scale compares incommensurable things — never do it.)

**Gate 2 — Class-specific justification (hard).** The standard depends on the router:

| Class            | Must clear, else **dropped**                                                                       | Must NOT be judged on                |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `differentiator` | Thesis-deepening **and** a falsifiable bet: "what observation in 6 months would prove this wrong?" | current demand — bets rarely show it |
| `table_stakes`   | **Category credibility**: N peers ship it and its _absence_ is a visible hole (cite the READMEs)   | differentiation — it isn't unique    |
| `nice_to_have`   | **Cited demand**: a named, dated instance of the pain (see below)                                  | —                                    |

**Scores — ordering only, never admission.** Once a candidate has passed both gates it is **in**. Score two things, and these decide only **priority rank and how thin the first cut is**, not in/out:

- **Cost & complexity** — build _plus_ permanent maintenance, against the repo's 300-line / complexity-15 ceilings.
- **Reversibility** — cheap to undo if the bet is wrong, or load-bearing once shipped?

### What counts as evidence (the N=1 rule)

Risoluto is founder-led and dogfooded, so "evidence of need" must not degrade into "the founder wants it, laundered through a rubric." For the `nice_to_have` demand gate, admissible evidence is a **named, dated instance** — `run #214 silently burned 40 min on a blocked slice`, `dogfood 2026-05-20: had to grep raw JSONL to see why role 3 failed` — never "users would want it." Cite the pain or drop the idea. `differentiator` and `table_stakes` candidates clear their own Gate-2 standards above and do **not** need demand evidence — applying a demand gate to them would kill the boldest and the most obviously-expected work alike.

Fold the served job and the classification into the row's **Why now** cell so the founder can rank without re-deriving them, e.g. `table-stakes for trust-while-AFK — 3 peers ship live run status; thin cut = poll endpoint`. For a `differentiator`, record the falsifiable bet there too.

At the end of each candidate's grill, draft a one-line **Why now** and a size estimate (S / M / L), show them to the founder, and ask: **"In or out?"**

- **In** → the candidate becomes a roadmap row. Confirm status: `idea` or `next` (the founder decides). Slug is derived from the candidate title (kebab-case).
- **Out** → the candidate is dropped. No row is written.

For **merge** candidates: instead of a new row, identify the existing roadmap row to fold into and state what text changes to make to its Why now cell.

For **supersede** candidates: mark the old roadmap row status `superseded` (with a note naming the new row), then add the new row.

### Step 3 — Write the roadmap rows

Once all candidates are grilled and in/out decisions are final, call the write script once with the full set of results:

```bash
node skills/risoluto-grill/scripts/grill-write.mjs <target-slug> \
  --results-file /tmp/grill-<slug>-results.json
```

The script:

1. Reads `docs/roadmap.md`.
2. For each `in` candidate: appends a new row to the roadmap table using the locked 6-column spec (`# | Item | Why now | Size | Status | Research link`). The Research link points to `research/targets/<slug>/README.md`. The slug is embedded as a trailing HTML comment in the Item cell: `Title <!-- slug:<slug> -->`.
3. For each `merge` candidate: edits the Why now cell of the target existing row.
4. For each `supersede` candidate: edits the Status cell of the old row to `superseded` (with a note), then appends the new row.
5. For `skip` candidates: writes nothing.
6. Reports the diff (rows added/edited) to stdout.

**Phase 2 note:** `grill-write.mjs` will be rewired to parse the results JSON, locate the roadmap table in `docs/roadmap.md`, and make surgical edits (append rows, patch cells) without touching unrelated rows or the file's surrounding prose. The intended results JSON shape is `{ in: [{ slug, title, why_now, size, status, flag, merge_target_row? }], out: [{ slug, title }] }`. Do not implement this yet — describe the intent here for reference.

Optional flags:

| Flag                    | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `--results-file <path>` | JSON file with all in/out decisions and row data. Required. |
| `--dry-run`             | Print the proposed roadmap diff, write nothing.             |

After the write, show Omer a summary: "Added N rows, edited M rows, dropped K candidates." Then stop — ranking is the founder's job.

### Step 4 — Validate

```bash
pnpm run build && pnpm run lint
```

The grill only touches `docs/roadmap.md` (markdown), so the build and lint gates are the appropriate fast check. No schema validation needed for the roadmap file itself — the locked table shape is enforced by convention.

### Step 5 — Commit

The grill writes only into the parent repo (`docs/roadmap.md`). Commit once:

```bash
git add docs/roadmap.md
git commit -m "chore: grill <slug> candidates → N roadmap rows"
```

If any supersede edits also bumped `research/` (unlikely — that directory is read-only here), bump the submodule pointer in a follow-up commit.

## Roadmap row ownership (what the grill writes)

| Column          | Behaviour                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#` (priority)  | Set to a placeholder (e.g. `?`) — the **founder ranks** after the grill. Never reorder existing rows.                                                                                    |
| `Item`          | Set to candidate title with slug comment: `Title <!-- slug:<slug> -->`.                                                                                                                  |
| `Why now`       | The grill's crisp one-liner, leading with the served AFK job + classification (differentiator / table-stakes / nice-to-have). For merge candidates: folded into the existing row's cell. |
| `Size`          | Set to S / M / L from the grill's estimate.                                                                                                                                              |
| `Status`        | Set to `idea` or `next` per the founder's decision.                                                                                                                                      |
| `Research link` | Always `research/targets/<target-slug>/README.md` for grill-produced rows.                                                                                                               |

The grill never touches rows it did not create or is not explicitly merging/superseding. It never reorders rows. It never promotes a row beyond `next` — only the founder does that.

## Why this skill is separate from `grill-me` and `grill-with-docs`

The global `~/.claude/skills/grill-me/` is a generic plan-stress-test prompt — no domain, no writes. The global `grill-with-docs/` is the same loop with inline glossary/ADR updates. Both stay generic and unchanged.

`risoluto-grill` is the **research-to-roadmap critic**: it pre-loads the research corpus (the target's candidates, the current roadmap, and the shipped-features spine), drives a loop framed specifically for "research has shown us N peers ship this — does Risoluto earn the right to ship it?", and writes the outcome directly into `docs/roadmap.md` using the locked row spec. Generalising it would dilute the seam — keeping it forked lets `grill-me` stay a 10-line prompt anyone can use anywhere.
