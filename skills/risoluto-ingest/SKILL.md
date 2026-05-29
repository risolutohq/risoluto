---
name: risoluto-ingest
description: Build or rebuild Risoluto's connected research wiki and generate gap-grounded roadmap ideas from the full research corpus — reads ALL `research/targets/**/README.md` and their sources, writes a wikilinked knowledge base at `research/wiki/` (a home note + per-concept notes that link targets together), then emits CITE-OR-DROP idea rows into `docs/roadmap.md` (status idea). An idea with no citation — no named dots connected, no gap filled — is silently dropped. Idempotent and non-interactive; run anytime the corpus grows. Use whenever Omer says `/risoluto-ingest`, "ingest the research", "build the research wiki", "rebuild the research wiki", "what gaps can we fill", "generate ideas from the corpus", "connect the dots across targets", "run the ingest", or any phrasing that implies turning the full target corpus into a connected big-picture or surfacing white-space opportunities. Do NOT trigger for single-target capture (use `/risoluto-researcher`) or for the critic-grill loop on a specific candidate (use `/risoluto-grill`).
---

# risoluto-ingest

Mode B of the research-to-shipping pipeline. Reads the full captured research corpus, builds a connected wiki, and surfaces gap-grounded ideas as candidate roadmap rows. Part of the shared funnel described in `docs/research-to-shipping-pipeline.md`.

## What this skill produces

Two write targets:

```
research/wiki/           ← inside the research/ submodule
  home.md               ← entry point; links to every concept note
  <concept>.md          ← one note per recurring theme; wikilinks targets together

docs/roadmap.md          ← parent repo
  (appended idea rows)  ← status: idea; Research link cites wiki note or targets
```

The wiki is the big picture. The roadmap rows are proposals. The founder ranks, promotes, and kills rows — the skill only appends at status `idea`.

## Hard preconditions

Stop and report if any fail:

| Check                         | Command                                           | If it fails                                                                          |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Run from repo root            | `test -f package.json && test -f .gitmodules`     | Tell Omer to `cd` into the `risoluto` checkout root.                                 |
| `research/` initialised       | `git submodule status research` starts with space | Tell Omer to `git submodule update --init research` or `/init-research`.             |
| `research/targets/` non-empty | `ls research/targets`                             | Tell Omer to capture targets via `/risoluto-researcher` first — no corpus to ingest. |

## The pipeline

Ingest is always full-corpus: every run reads every `research/targets/**/README.md` and every `research/targets/**/sources/*.md`, rebuilds the entire wiki, and re-evaluates every idea candidate. No incremental mode; this is what makes idempotency and re-runs on any corpus change safe.

### Step 1 — Run the ingest script

```bash
node skills/risoluto-ingest/scripts/ingest.mjs
```

The script (`ingest.mjs`) is built in Phase 2. Its intended behavior is described below under [Engine behavior](#engine-behavior). It is non-interactive and writes directly; no `--dry-run` gate is needed because appended roadmap rows are at status `idea` and require founder action before they can advance.

### Step 2 — Review wiki output

After the script exits, read `research/wiki/home.md`. It is the authoritative index of every concept the ingest pass recognised. Each concept note names the targets that evidence it and links them together via wikilinks (`[[target-slug]]`).

Review any concept notes that seem thin (only one target wikilinked) — a single-target concept is fine if the gap is real, but it should not generate an idea row unless the gap is clearly named.

### Step 3 — Review proposed roadmap rows

Open `docs/roadmap.md` and scroll to the newly appended rows (status `idea`). Each row:

- Has a short title and a Research link pointing at `research/wiki/<concept>.md` or `research/targets/<slug>/README.md`.
- Has an empty Why now cell and an empty Size cell — these must be filled by the founder before the row can be promoted to `next`.
- Has a slug comment in the Item cell: `Title <!-- slug:<slug> -->` — the join key for the rest of the pipeline.

No row is added without a citation. Rows without a citation were dropped by the script, not deferred.

### Step 4 — Dedup check

Before a proposed idea row enters the founder's inbox it must be checked against:

1. **Already-shipped features** — `research/RISOLUTO_FEATURES.md`. If the idea describes a feature already shipped, mark the row `dropped` with the reason ("already shipped: <feature>") in the Why now cell.
2. **Existing roadmap rows** — scan `docs/roadmap.md` for overlapping rows. If overlap exists, fold the new citation into the existing row's Research link instead of adding a duplicate.

The script performs an automated best-effort dedup. Manual review catches edge cases the script misses.

### Step 5 — Commit

Ingest writes into two repos. Commit the submodule first, then the parent:

```bash
cd research
git add wiki/
git commit -m "research: rebuild wiki from ingest"
git push
cd ..
git add research docs/roadmap.md
git commit -m "chore: bump research submodule + append ingest idea rows to roadmap"
```

## Engine behavior

This section describes what `ingest.mjs` does when built. It is a spec, not an implementation.

### Wiki construction

1. Walk `research/targets/**/README.md` and `research/targets/**/sources/*.md`. Extract the body text and any structured frontmatter (capabilities, tags, summary).
2. Identify recurring themes across targets — patterns, capabilities, primitives, or gaps that appear in more than one target or that a single target makes unusually sharp. Each theme becomes a concept note at `research/wiki/<concept-slug>.md`.
3. Each concept note contains:
   - A one-paragraph summary of the theme.
   - A `## Targets` section that wikilinks every target evidencing the theme: `[[targets/<slug>]]`.
   - A `## Gap` section: what none of the targets do, or what they all do poorly, or what composing two of them would enable that neither does alone.
4. `research/wiki/home.md` is the index: a table of all concept notes with a one-line summary and target count.

The wiki is rebuilt from scratch on every run (idempotent). Existing concept notes are overwritten; manually added notes outside the script's slug namespace are left untouched.

### Idea generation — cite-or-drop

After the wiki is written, the script generates idea candidates:

1. For each concept note whose `## Gap` section is non-empty: emit one candidate idea.
2. The candidate must name:
   - The dots it connects: which targets, wiki notes, or primitives it draws from.
   - The gap it fills: the specific thing A, B, and C all do but none do well — or what A + B compose into that neither does alone.
3. If the candidate cannot be expressed in terms of named dots and a named gap, it is **dropped** (cite-or-drop rule). No citation → no row.
4. Surviving candidates are appended to `docs/roadmap.md` as `idea`-status rows using the locked row spec:

   ```
   | # | Item | Why now | Size | Status | Research link |
   ```

   `#` is left blank (founder assigns priority). Item carries the slug comment. Why now and Size are left blank. Status is `idea`. Research link points to `research/wiki/<concept>.md`.

### Idempotency

Re-running ingest with no corpus changes produces the same wiki and the same candidate set. Rows already present in `docs/roadmap.md` (any status) are not duplicated — the script scans existing slugs before appending.

## Two-repo / submodule note

The wiki (`research/wiki/`) lives inside the `research/` submodule (`risolutohq/risoluto-research`). Changes there must be committed and pushed inside the submodule before the parent repo can record the updated submodule pointer. The roadmap (`docs/roadmap.md`) lives in the parent repo (`risolutohq/risoluto`). These are two separate commits (see Step 5). Never commit only the parent without first committing and pushing the submodule, or the submodule pointer will reference an unpushed commit.

## Skills propose; the founder disposes

Appended roadmap rows are at status `idea`. They are proposals. The founder (Omer) decides which rows are worth pursuing, fills in Why now and Size, and promotes rows to `next`. No skill reorders, promotes, or deletes roadmap rows. The ingest skill only appends.

## How ingest relates to the other pipeline skills

| Skill                  | Role                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `/risoluto-researcher` | Captures ONE source; writes `research/targets/<slug>/README.md`. Mode A entry point. |
| `/risoluto-ingest`     | Reads ALL targets; builds wiki; generates idea rows. Mode B. Run anytime.            |
| `/risoluto-grill`      | Critic loop on specific candidates (from Mode A or Mode B) after dedup.              |
| `/risoluto-to-prd`     | Reads a `next`-status roadmap row; writes a PRD. Back-half.                          |

Ingest does not replace the researcher — it is complementary. The researcher goes deep on one source; ingest finds the cross-target signal the researcher cannot see in isolation.
