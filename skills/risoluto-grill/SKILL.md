---
name: risoluto-grill
description: Stress-test a Risoluto research idea against the corpus and the product spine until two operator-owned sections crystallise — `## Why us / why now` and `## Smallest shippable shape` — in `research/ideas/<slug>/README.md`. Pre-loads the idea README, every cited target README, the matching `capability-backlog.md` row, and any `research/RISOLUTO_FEATURES.md` bundles the idea touches, then runs a grill loop framed for the research→product seam ("you have N peers doing X, why us, why now, smallest cut") with one question at a time. On exit, writes the two sections via the deterministic write script (preserving frontmatter, the synthesizer-owned block, and `## Analyst notes` / `## Open questions` verbatim) and offers to flip the backlog row from `status: idea` to `status: ready`. Use this skill whenever Omer says `/risoluto-grill`, "grill <idea-slug>", "stress-test the <slug> idea", "fill in why us / why now for <slug>", "scope the smallest shippable shape of <slug>", "promote <slug> from idea to ready", or any variation that implies turning a clustered idea into a scoped, shippable bet. Also trigger when Omer asks "what's the thinnest slice of <slug>?", "why should Risoluto ship <slug> before competitors X and Y?", or wants to walk the seam between research clusters and product decisions. Idempotent — re-running re-grills, operator keeps iterating; the two sections are the only ones the write touches. Companion to Phase 3.1 of `docs/planning-pipeline-roadmap.md`.
---

# risoluto-grill

Idea-to-bet sharpener for the Risoluto planning pipeline. Phase 3.1 of the planning-pipeline roadmap.

## What this skill produces

For one idea-slug at a time, this skill drives a grilling conversation framed for the research→product seam and writes the two operator-owned outcome sections into the existing idea README:

```
research/ideas/<idea-slug>/README.md
  ## Why us / why now           ← rewritten by /risoluto-grill
  ## Smallest shippable shape   ← rewritten by /risoluto-grill
```

Everything else in the README is preserved verbatim:

- YAML frontmatter (`slug`, `evidence_targets`, `evidence_sources`, `linear_project`, `prd_file`).
- The synthesizer-owned block between `<!-- BEGIN risoluto-synthesizer -->` / `<!-- END risoluto-synthesizer -->` (`## Evidence`, `## Targets that ship this`, `## Variants observed`, `## Frequency`).
- `## Analyst notes` and `## Open questions` (operator-owned, not regenerated).

Optionally, after the grill, the skill offers to flip the matching row in `docs/capability-backlog.md` from `status: idea` to `status: ready`. The synthesizer (Phase 2.1) treats `ready` as operator-set and never overwrites it on subsequent runs.

## Hard preconditions

Stop and report if any fail:

| Check                                       | Command                                            | If it fails                                                                          |
| ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Run from repo root                          | `test -f package.json && test -f .gitmodules`      | Tell Omer to `cd` into the `risoluto` checkout root.                                 |
| `research/` initialised                     | `git submodule status research` starts with space  | Tell Omer to `git submodule update --init research` or `/init-research`.             |
| Idea exists                                 | `test -f research/ideas/<slug>/README.md`          | Tell Omer to run `/risoluto-synthesizer` first so the idea folder + sections exist.  |
| `docs/capability-backlog.md` exists         | `test -f docs/capability-backlog.md`               | This file is committed at v1 — if missing, the repo is in an unexpected state.       |

## The pipeline

The skill is three steps: **preload**, **grill**, **write**. The grill (the conversation itself) happens in the agent's head — the two scripts handle the deterministic context gathering and the final write so re-runs are idempotent.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-grill/scripts/preload.mjs <idea-slug>
```

The script prints, to stdout, a JSON document listing every file the agent should read before opening the grill:

- The idea README itself.
- Every `research/targets/<target-slug>/README.md` cited in `evidence_targets`.
- Every source file in `evidence_sources`.
- `docs/capability-backlog.md` (the row authoritatively holds `name` + `category` + current `status`).
- Any `research/RISOLUTO_FEATURES.md` features whose `bundle` or behaviour text mentions the idea slug — these are the features Risoluto already ships in the same neighbourhood, and they're the strongest "why us" anchor.

The script does not read or load anything itself — it prints paths. The agent then uses the standard read tools to load those files into the conversation. Show Omer a one-line summary ("loaded N targets, M sources, K features-spine hits") before grilling — don't dump raw file contents.

### Step 2 — Grill

Open the loop with the idea's current shape framed for the seam between research and product. Ask **one question at a time**, wait for the operator's answer, and only then continue to the next branch.

The grill is not a generic plan-review — it is a **research→product** stress test. The corpus has already told you what your peers ship. The operator's job is to defend (or kill) Risoluto's right to ship the same capability. Drive toward two crisp paragraphs:

1. **Why us / why now** — what is Risoluto's structural advantage relative to the N cited peers? What is true today that wasn't true 12 months ago (or what is about to be true 12 months from now)? If the answer is "nothing", surface it — that's a kill signal worth knowing.
2. **Smallest shippable shape** — the thinnest cut that proves the bet end-to-end, expressed against Risoluto's spine (workflow runs, tracker adapters, harness adapters, etc.). Not a feature list — a tracer that can land in one or two PRs and surface a real signal.

Branches to walk, in order, asking one question at a time and recommending an answer with each:

1. **Peer landscape** — "Of `evidence_targets` ∈ {…}, which is the strongest peer? Which is the closest in shape to what you'd build?" Pre-loaded target READMEs give you the bullets — quote them back.
2. **Risoluto's right to ship** — "Your spine ships A, B, C in this neighbourhood (cite the matching `RISOLUTO_FEATURES.md` entries). Does the idea compose with those, or does it require a new primitive?"
3. **Timing** — "Why now and not 6 months ago / 6 months from now? What changed in the corpus, in the platform, or in the operator's day that makes this the next bet?"
4. **Failure mode** — "What does this look like at month 6 if it ships and nobody uses it? What does the kill-condition look like?"
5. **Smallest cut** — "If you had to ship one Linear ticket today and call it the tracer, what would it do? What does it _not_ do?"
6. **Open questions left** — "What is still uncertain? Park those in `## Open questions` (operator-owned) — the grill doesn't have to resolve everything, but the unresolved bits must be named."

If the operator stalls or contradicts something in the pre-loaded corpus, surface it directly: "Your `provider-abstraction` README quotes Composio shipping X — your answer assumes Risoluto already has Y. Which is true?"

When the operator signals "we're done" (or both sections feel sharp), draft the two final paragraphs and show them inline before writing.

### Step 3 — Write the sections

Once Omer signs off on the drafts, save each section's body to a tmp file and call the write script:

```bash
node skills/risoluto-grill/scripts/grill-write.mjs <idea-slug> \
  --why-us-file /tmp/grill-<slug>-why-us.md \
  --smallest-shape-file /tmp/grill-<slug>-smallest-shape.md
```

The script:

1. Reads `research/ideas/<idea-slug>/README.md`.
2. Locates `## Why us / why now` and `## Smallest shippable shape` and replaces their bodies (everything until the next `## ` heading or EOF) with the new content. The headings themselves are preserved.
3. Leaves frontmatter, the synthesizer-owned block, `## Analyst notes`, and `## Open questions` byte-identical.
4. Writes the result and reports the diff in lines added/removed.

Optional flags:

| Flag                    | Description                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `--why-us-file <path>`  | File containing the new `## Why us / why now` body (markdown, no heading). Required.              |
| `--smallest-shape-file <path>` | File containing the new `## Smallest shippable shape` body. Required.                       |
| `--flip-to-ready`       | After the write, flips the matching backlog row from `status: idea` to `status: ready`.           |
| `--dry-run`             | Print the proposed diff, write nothing.                                                           |

After the write, ask Omer one question: **"Promote `<slug>` from `idea` to `ready` in the backlog?"** If yes, re-run with `--flip-to-ready` (it is idempotent — re-running on a `ready` row is a no-op).

### Step 4 — Validate

```bash
pnpm validate:research
```

Confirms the regenerated `research/ideas/<idea-slug>/README.md` still passes `idea.schema.json` — the grill never touches frontmatter, so this should pass unconditionally, but it's the safety net against accidental corruption.

### Step 5 — Commit

The grill writes into two repos at once: `research/` (the idea README lives in the submodule) and the parent repo (if `--flip-to-ready` ran, the backlog row moved). Commit submodule first:

```bash
cd research
git add ideas/<slug>/README.md
git commit -m "research: grill <slug> — why us / smallest shape"
git push
cd ..
git add research docs/capability-backlog.md
git commit -m "chore: bump research submodule + promote <slug> to ready"
```

If `--flip-to-ready` was not used, the second commit only bumps the submodule.

## Idea README ownership (what the grill touches on re-runs)

| Section / Field                              | Behaviour                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Frontmatter (all fields)                     | **Never** touched.                                                                         |
| Synthesizer-owned block (BEGIN/END markers)  | **Never** touched — that's `/risoluto-synthesizer`'s territory.                            |
| `## Analyst notes`                           | **Never** touched — operator-owned, not regenerated.                                       |
| `## Open questions`                          | **Never** touched — operator-owned, not regenerated.                                       |
| `## Why us / why now`                        | Body fully rewritten on every grill. Re-running re-grills.                                 |
| `## Smallest shippable shape`                | Body fully rewritten on every grill. Re-running re-grills.                                 |

The grill replaces only the body between each heading and the next `## ` heading (or EOF). No partial merges, no comment markers — the operator iterates by re-running, not by hand-editing fragments.

## Backlog row ownership

| Column          | Behaviour                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `slug`          | Never touched.                                                                                     |
| `name`          | Never touched.                                                                                     |
| `category`      | Never touched.                                                                                     |
| `status`        | Flipped from `idea` to `ready` only when `--flip-to-ready` is passed. Idempotent: re-running on `ready` / `in-flight` / `shipped` is a no-op. |
| `evidence_idea` | Never touched.                                                                                     |

The grill only ever flips one direction (`idea` → `ready`). Demotions (`ready` → `idea`) are not a real workflow — if the bet is killed, the operator sets `status: dropped` by hand, with the reason note required by [docs/capability-backlog.md](../../docs/capability-backlog.md)'s status vocabulary.

## Smoke test

The repo has a clustered idea at `research/ideas/provider-abstraction/` (Phase 2.3 dogfood). Running the grill on it:

```bash
node skills/risoluto-grill/scripts/preload.mjs provider-abstraction
# (run the loop in conversation; draft the two paragraphs; save to tmp files)
node skills/risoluto-grill/scripts/grill-write.mjs provider-abstraction \
  --why-us-file /tmp/grill-provider-abstraction-why-us.md \
  --smallest-shape-file /tmp/grill-provider-abstraction-smallest-shape.md \
  --dry-run
```

Expected output:

- `preload.mjs` prints a JSON manifest with `idea`, `targets`, `sources`, `features`, `backlog_row` keys — non-empty for `provider-abstraction`.
- `grill-write.mjs --dry-run` prints the proposed diff: two section bodies rewritten, everything else byte-identical.
- A real (non-dry-run) call writes the file; re-running with the same flags produces a clean `unchanged` (same content) or a fresh diff (operator iterated). `## Why us / why now` and `## Smallest shippable shape` are the only sections that change.
- A follow-up `--flip-to-ready` flips the matching backlog row to `ready`; running it again is a no-op.
- `pnpm validate:research` reports all files OK.

## Why this skill is separate from `grill-me` and `grill-with-docs`

The global `~/.claude/skills/grill-me/` is a generic plan-stress-test prompt — no domain, no writes. The global `grill-with-docs/` is the same loop with inline glossary/ADR updates. Both stay generic and unchanged.

`risoluto-grill` is the **product-seam** variant: it pre-loads the research corpus (the cluster's evidence + the spine's existing surface), drives a loop framed specifically for "research has shown us N peers ship this — does Risoluto?", and writes two pre-named operator-owned sections back into a known file shape. Generalising it would dilute the seam — keeping it forked lets `grill-me` stay a 10-line prompt anyone can use anywhere.

## Eval scaffolding

`evals/evals.json` holds trigger-test prompts for the description. Run skill-creator's `run_loop.py` to benchmark and tighten the description's triggering accuracy:

```bash
python -m scripts.run_loop \
  --eval-set skills/risoluto-grill/evals/evals.json \
  --skill-path skills/risoluto-grill \
  --model <current-model-id> \
  --max-iterations 5 \
  --verbose
```

(Run from the skill-creator root, not the risoluto root.)
