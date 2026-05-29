---
name: risoluto-features
description: 'Update the Risoluto Feature Spine, the code-backed inventory of user-observable and backend-surface features. Use when Omer says /risoluto-features, "update the spine", "regenerate risoluto features", "check what''s new in risoluto", "diff the risoluto spine", "refresh feature inventory", or "rebuild RISOLUTO_FEATURES". Uses the two-repo model: source code in `.spine-workspace/source/`, spine output in the private `research/` submodule. Re-verifies existing entries, detects net-new features, preserves analyst nuance, renders markdown/json/html, validates citations, and requires an AskUserQuestion commit gate.'
---

# Risoluto Feature Spine Updater

## Two-repo model — read this first

Risoluto uses two GitHub repos for spine work, and confusing them is the dominant cause of bad runs:

| Role        | GitHub                         | Local path                                                    | What it holds                                                                    |
| ----------- | ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Source**  | `risolutohq/risoluto`          | `.spine-workspace/source/` (cloned by this skill, gitignored) | The actual `src/` tree. Every spine citation points HERE.                        |
| **Storage** | `risolutohq/risoluto-research` | `research/` (submodule of risoluto)                           | The spine files themselves (`RISOLUTO_FEATURES.md/.json/.html`). NO source code. |

**Cited paths in the spine are relative to the SOURCE repo, not the storage repo.** The spine output gets written and committed inside the STORAGE repo, but its citations resolve in the SOURCE repo. The JSON sidecar records both via `source_repo.local_path` and `storage_repo.submodule_path` so validators auto-target the right one.

If you ever find yourself running `grep` or `cat` against `research/src/*.ts` — **stop**. That directory is empty by design. You want `.spine-workspace/source/src/*.ts`.

## What this skill produces

Three files inside `research/`, kept tightly in sync:

1. **`research/RISOLUTO_FEATURES.md`** — the human-readable spine. Markdown, organised by bundle, `file:Lx-Ly — Symbol` evidence for every claim. **Source of truth** for git diffs and consumer parsing.
2. **`research/RISOLUTO_FEATURES.json`** — structured sidecar, denormalised. Schema in `references/json-schema.md`.
3. **`research/RISOLUTO_FEATURES.html`** — generated viewer. Single-file Tailwind+vanilla-JS, sourced from the JSON. Cold-start-aware, filters only render when discriminating.

The skill is **incremental**. It re-verifies existing entries, adds entries for net-new features, marks removed features in a "Changed since last spine" rollup at the top, and **never** silently regenerates human-curated nuance — `## Analyst notes` and `## Needs follow-up` evolve forward, they aren't blown away.

## Architecture — main agent + per-module subagents

For cold start and incremental updates, this skill uses **map-reduce**: the main agent stays light (orchestration, decisions, user interaction) while per-module subagents do the heavy reads against source code in parallel. This keeps main context under ~15% even on cold start with 100+ features.

```
Main agent (you)
  │
  ├─→ preflight, sync repos, plan modules
  │
  ├─→ Subagent(module=src/notification/)       ─┐
  ├─→ Subagent(module=src/orchestrator/)        │  parallel
  ├─→ Subagent(module=src/persistence/sqlite/)  │
  ├─→ ... one per src/<module>/                ─┘
  │   each returns JSON array of feature records
  │
  ├─→ merge, assign bundles, render meta, build diff section
  ├─→ render markdown + json + html
  ├─→ validate_json + fact_check + lint_md (all must pass)
  └─→ AskUserQuestion gate → commit
```

Subagent prompt templates live in `references/subagent-prompts.md`. Use the **`extract` template** for cold start / new-module runs. Use the **`verify` template** to re-check batches of existing entries on incremental runs.

## Hard preconditions

Stop and report if any fail. Don't try to recover; tell Omer.

| Check                                     | Command                                                                                                                                 | If it fails                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| In a risoluto worktree                    | `git rev-parse --show-toplevel` ends in `risoluto`                                                                                      | Tell Omer to `cd` into the risoluto worktree.                                     |
| `research/` submodule present             | `test -e research/.git`                                                                                                                 | Tell Omer to `git submodule update --init research`.                              |
| `research/` working tree clean            | `git -C research status --porcelain` empty                                                                                              | List what's dirty; refuse and ask to commit/stash.                                |
| `research/` up-to-date with origin        | `git -C research fetch origin && git -C research log @{u}..HEAD` empty                                                                  | Refuse — unpushed commits would be lost on bump.                                  |
| `gh` authenticated for both private repos | `gh repo view risolutohq/risoluto --json visibility` AND `gh repo view risolutohq/risoluto-research --json visibility` both return JSON | Tell Omer to `gh auth login`.                                                     |
| `.spine-workspace/` is gitignored         | `git check-ignore .spine-workspace/source 2>/dev/null` returns the path                                                                 | If not, append `/.spine-workspace/` to risoluto's root `.gitignore` and stage it. |

## The pipeline

Run these steps in order. Each step is a checkpoint — finish it before the next.

### Step 1 — Sync both repos

```bash
# Source repo (where the cited code lives)
SOURCE_DIR=".spine-workspace/source"
if [ ! -d "$SOURCE_DIR/.git" ]; then
  mkdir -p .spine-workspace
  git clone --quiet https://github.com/risolutohq/risoluto.git "$SOURCE_DIR"
else
  git -C "$SOURCE_DIR" fetch --quiet origin master
  git -C "$SOURCE_DIR" checkout --quiet origin/master
fi
SOURCE_SHA=$(git -C "$SOURCE_DIR" rev-parse HEAD)
SOURCE_DESCRIBE=$(git -C "$SOURCE_DIR" describe --tags --always 2>/dev/null || echo "$SOURCE_SHA")
SOURCE_DATE=$(git -C "$SOURCE_DIR" log -1 --format=%cd --date=short)

# Storage repo (where the spine lives)
STORAGE_DIR="research"
git -C "$STORAGE_DIR" fetch --quiet origin
git -C "$STORAGE_DIR" checkout --quiet -B spine-updates origin/master
```

The `checkout -B spine-updates` line is important: it creates (or fast-forwards to) a branch named `spine-updates` so the eventual commit is NOT on detached HEAD. First run creates the branch; subsequent runs reuse it.

Record `SOURCE_SHA`, `SOURCE_DESCRIBE`, `SOURCE_DATE` — they go into the new spine's frontmatter under `source_repo`.

### Step 2 — Load previous state

```bash
PREV_SHA=$(grep -m1 '^- \*\*Commit SHA:\*\*' "$STORAGE_DIR/RISOLUTO_FEATURES.md" 2>/dev/null | grep -oE '`[a-f0-9]+`' | tr -d '`')
```

If `$PREV_SHA` is empty, this is a **cold start** — follow `references/cold-start.md` then resume at Step 6. Otherwise read `$STORAGE_DIR/RISOLUTO_FEATURES.json` into memory as the prior state.

### Step 3 — Gather change signals (all four in parallel)

Triangulate what changed between `$PREV_SHA..$SOURCE_SHA` in the SOURCE repo.

- **A. git log:** `git -C "$SOURCE_DIR" log --oneline $PREV_SHA..$SOURCE_SHA`
- **B. closed GitHub issues** (on `risolutohq/risoluto`): `gh api -X GET "repos/risolutohq/risoluto/issues" -f state=closed -f since=<PREV_DATE> --jq '.[] | {number, title, labels: [.labels[].name], closed_at}'`
- **C. new top-level exports:** for each file in `git -C "$SOURCE_DIR" diff --name-only $PREV_SHA..$SOURCE_SHA -- 'src/**'`, look for new `export class|function|const` lines vs the old ref
- **D. docs/spec scan:** `git -C "$SOURCE_DIR" diff --name-only $PREV_SHA..$SOURCE_SHA -- 'docs/**' 'README.md' 'CHANGELOG.md' 'CLAUDE.md'`

When 2+ signals converge on the same area, it's almost certainly a feature.

### Step 4 — Verify existing entries (spawn batch subagents)

Chunk existing entries into batches of ~15 and spawn one subagent per batch using the **`verify` template** from `references/subagent-prompts.md`. Each subagent:

- Reads the assigned features' citations against `$SOURCE_DIR`
- Walks `references/verification-checklist.md`
- Returns updated JSON (with `verified_at` bumped, citation line ranges auto-corrected, modified constants flagged)

Wait for all subagents. Merge their outputs into the working JSON.

### Step 5 — Extract net-new features (spawn per-module subagents)

For each `src/<module>/` (and `frontend/src/` if present) where Step 3 signals indicate change, spawn one subagent using the **`extract` template** from `references/subagent-prompts.md`. Each subagent:

- Reads its module's `.ts` files in `$SOURCE_DIR`
- Identifies user-observable features OR backend-surface mechanisms rooted in that module
- Returns a JSON array of feature records with verified citations and quoted constants

Main agent collects, deduplicates by `id`, assigns bundles via `references/bundle-rules.md`.

### Step 6 — Recompute meta sections

```bash
# Write the *next* JSON first so scripts work on the staged payload
python3 skills/risoluto-features/scripts/render_meta.py \
  --json "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" --section summary
python3 skills/risoluto-features/scripts/render_meta.py \
  --json "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" --section coverage \
  --repo "$SOURCE_DIR"
```

These two calls print markdown for the `.md` body. The same derived Summary + Coverage are
**also persisted into the JSON sidecar** at the start of Step 10 (after all other JSON edits)
so the sidecar matches the `.md` and the HTML viewer can render the Coverage table.

### Step 7 — Evolve Needs follow-up & Analyst notes

Don't blow them away — **evolve them**:

- **Needs follow-up:** for each existing item, try to resolve it using current code state. If resolved, move it to `### Recently resolved` and drop it next cycle. Add new items for ambiguities discovered in Steps 4–5.
- **Analyst notes:** preserve subsections (`### README/spec vs. code drift`, etc.). Append new bullets, drop bullets that no longer apply (note in the commit message).

### Step 8 — Build "Changed since last spine"

```bash
python3 skills/risoluto-features/scripts/diff_spines.py \
  --old "$STORAGE_DIR/RISOLUTO_FEATURES.json" \
  --new "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" \
  --from-sha "$PREV_SHA" --to-sha "$SOURCE_SHA"
```

Added → Modified → Removed, with anchor links. On cold start, output is the "Initial spine cut at `<sha>`" message.

### Step 9 — Render markdown atomically

Layout (top to bottom): H1 + intro → frontmatter list (with `source_repo` + `storage_repo` blocks) → `---` → Changed since last spine → `---` → per-bundle H2 sections → `---` → Summary → Coverage manifest → Needs follow-up → Analyst notes.

Write to `.next` files first; only rename to `.md` and `.json` after Step 10 passes.

### Step 10 — Validate (three gates, all must pass)

```bash
# 0. Finalize derived fields: persist Summary + Coverage into the JSON sidecar. Runs LAST
#    (after every Step 6-9 JSON edit) so it always reflects the final feature set. Without
#    it the JSON `coverage` stays empty and the HTML viewer's Coverage table renders blank.
python3 skills/risoluto-features/scripts/render_meta.py \
  --json "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" --write --repo "$SOURCE_DIR"

# 1. JSON schema + citation paths exist
python3 skills/risoluto-features/scripts/validate_json.py \
  "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" \
  --source-repo "$SOURCE_DIR" || { echo "JSON validation failed — aborting"; exit 1; }

# 2. Fact-check: quoted constants exist in cited code
python3 skills/risoluto-features/scripts/fact_check.py \
  "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" \
  --source-repo "$SOURCE_DIR"
# Exit codes: 0 clean, 1 hard fail (abort), 2 soft warnings (proceed but surface them).
# If exit code was 1, ABORT — fix entries before continuing.

# 3. Markdown lint: catches duplicate H3s, stray template tokens, malformed citation lines
python3 skills/risoluto-features/scripts/lint_md.py \
  "$STORAGE_DIR/RISOLUTO_FEATURES.md.next" || { echo "Lint failed — fix and re-render"; exit 1; }
```

If `fact_check.py` returns soft warnings (exit 2), include the warning list in the proposed commit message body so Omer sees them. Hard fails abort the run — fix the entries (usually: widen citation ranges to include quoted constants, or replace phrase-shaped citation symbols with real identifiers).

Then atomic rename:

```bash
mv "$STORAGE_DIR/RISOLUTO_FEATURES.md"    "$STORAGE_DIR/RISOLUTO_FEATURES.md.prev"   2>/dev/null || true
mv "$STORAGE_DIR/RISOLUTO_FEATURES.json"  "$STORAGE_DIR/RISOLUTO_FEATURES.json.prev" 2>/dev/null || true
mv "$STORAGE_DIR/RISOLUTO_FEATURES.md.next"   "$STORAGE_DIR/RISOLUTO_FEATURES.md"
mv "$STORAGE_DIR/RISOLUTO_FEATURES.json.next" "$STORAGE_DIR/RISOLUTO_FEATURES.json"
```

### Step 11 — Render HTML viewer

```bash
python3 skills/risoluto-features/scripts/render_html.py \
  --json "$STORAGE_DIR/RISOLUTO_FEATURES.json" \
  --out  "$STORAGE_DIR/RISOLUTO_FEATURES.html"
```

The viewer is cold-start-aware (filters that wouldn't discriminate are hidden, "Initial spine cut" banner replaces the diff chips when there's no previous SHA).

### Step 12 — Commit gate (MANDATORY AskUserQuestion)

> **STOP**. Do NOT run `git commit` next. The previous version of this skill instructed "show the message and wait" via prose, and models proceeded anyway. Use the `AskUserQuestion` tool as the gate. Tool calls are harder to bypass than prose instructions.

Construct the proposed commit message:

```
docs(spine): update to <SHORT_SHA> (+<N> new, ~<M> modified, -<K> removed)

Bumped source repo (risolutohq/risoluto) from <PREV_SHA> to <SOURCE_SHA> (<SOURCE_DATE>).

Added:
- <feature name> (#issue)
  ...

Modified:
- <feature name>: <one-line reason>
  ...

Removed:
- <feature name>: <one-line reason>
  ...

Resolved follow-ups:
- <item>

New analyst notes:
- <bullet>

fact_check: <0 hard, N soft warning(s)> [list each soft warning briefly]
```

Then **call `AskUserQuestion`** with that message embedded as the question text and these options:

- **Apply with this message** — proceed to commit
- **Modify the message** — ask follow-up; iterate the message; call AskUserQuestion again
- **Cancel** — leave files written but don't commit

ONLY after receiving "Apply", run:

```bash
git -C "$STORAGE_DIR" add RISOLUTO_FEATURES.md RISOLUTO_FEATURES.json RISOLUTO_FEATURES.html
git -C "$STORAGE_DIR" commit -m "<approved message>"
git add research
git commit -m "chore: bump research/ to <SHORT_SHA> (spine update)"
```

Push only if Omer explicitly asks. Never on your own.

### Step 13 — Cleanup

```bash
rm -f "$STORAGE_DIR/RISOLUTO_FEATURES.md.prev" "$STORAGE_DIR/RISOLUTO_FEATURES.json.prev"
# Keep .spine-workspace/source/ across runs — next run reuses it via `git fetch + checkout`.
```

## Cold start

If `$PREV_SHA` is empty (Step 2), follow `references/cold-start.md` for Steps 3–5, then resume at Step 6.

## Reference files

- `references/feature-entry-template.md` — markdown + JSON shape for one entry
- `references/json-schema.md` — full JSON schema with v1.1 two-repo fields
- `references/bundle-rules.md` — 11 bundles, what belongs in each, decision tree
- `references/verification-checklist.md` — per-entry checks for Step 4
- `references/diff-section.md` — template for "Changed since last spine"
- `references/cold-start.md` — first-run procedure (two-repo aware)
- `references/subagent-prompts.md` — extract + verify subagent prompt templates

## Scripts

- `render_meta.py` — Summary table + Coverage manifest from JSON. `--section {summary,coverage}` prints markdown for the `.md` body; `--write` persists both back into the JSON sidecar (Step 6) so the HTML viewer and JSON consumers stay in sync.
- `diff_spines.py` — old vs new JSON → markdown/JSON diff
- `validate_json.py` — schema validation, auto-resolves source_repo for path checks
- `fact_check.py` — quoted constants must appear in cited code (anti-hallucination)
- `lint_md.py` — duplicate H3s, template tokens, malformed citation lines
- `render_html.py` — hydrates `assets/viewer-template.html` with JSON

## Assets

- `assets/viewer-template.html` — single-file viewer, OKLCH palette, cold-start-aware filters

## Why this is structured the way it is

A feature spine is only useful if it's **falsifiable** and **fresh**. Falsifiable means every claim points to a specific file range and a real symbol, AND that quoted constants actually appear in cited code. Fresh means it tracks HEAD, not a snapshot. The biggest failure mode is silent rot — line numbers drift, constants get tweaked, features get yanked. The verification step (Step 4) plus `fact_check.py` (Step 10) is what keeps the spine honest.

The second-biggest failure mode is the model committing without approval. Prose-based "stop and wait" instructions get bypassed; a mandatory `AskUserQuestion` tool call doesn't.

The third-biggest failure mode is confusing the source and storage repos. The two-repo model and `source_repo.local_path` in the JSON make the distinction explicit so validators auto-target the right tree.

Subagent map-reduce exists because reading 100+ source files in the main agent's context burns 30%+ of context per run. Per-module subagents do the file reads in isolated contexts; the main agent only sees their JSON outputs and stays compact across the session.
