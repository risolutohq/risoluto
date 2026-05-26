# Cold-start procedure

When `research/RISOLUTO_FEATURES.md` doesn't exist yet (first ever run), follow this procedure instead of Steps 3–5 of the main pipeline. The rest (Steps 1–2, 6–13) is unchanged.

A cold start is **slow**. There's no prior spine to verify against; every feature has to be discovered from scratch. Budget accordingly — expect the per-module subagent fan-out to take 10–20 minutes wall-clock for a 100-feature codebase.

## When this applies

- `research/RISOLUTO_FEATURES.md` doesn't exist on disk after Step 2.
- OR the file exists but the frontmatter doesn't contain a parseable `Commit SHA:` line (corrupted / hand-edited).

If the file exists with a valid SHA but `RISOLUTO_FEATURES.json` is missing, that's a **partial cold start** — you have the markdown to reverse-engineer prior entries from, but no structured prior state. Treat like cold start but seed entries by parsing the existing markdown; mark each as `confidence: "medium"` until the next run can re-verify.

## Procedure (replaces Steps 3–5)

### 1. Read the orientation docs in `$SOURCE_DIR`

In this order:
1. `README.md` — top-line feature claims
2. `CLAUDE.md` or `AGENTS.md` — architectural overview
3. `docs/CONFORMANCE_AUDIT.md` if present — explicit feature audit, your closest prior art
4. `docs/ROADMAP_AND_STATUS.md` if present — what's shipped vs. open
5. `CHANGELOG.md` — chronological ship log
6. `docs/decisions.md` or `docs/adr/` if present — design intent

These tell you which features the project itself *claims* to ship. Use them as candidate seeds — but **never as final evidence**. Every claim must be re-verified by reading actual code.

### 2. Enumerate modules and plan subagent fan-out

```bash
ls "$SOURCE_DIR/src/"
find "$SOURCE_DIR/src" -maxdepth 1 -type d -not -name 'src'
test -d "$SOURCE_DIR/frontend/src" && ls "$SOURCE_DIR/frontend/src/"
```

You're building the list of subagents to spawn — one per top-level `src/<module>/`. Some modules are pure plumbing and you'll get back an empty array (that's fine — the subagent's own judgment).

### 3. Pull closed roadmap issues for additional candidates

```bash
gh api -X GET "repos/risolutohq/risoluto/issues" \
  -f state=closed -f per_page=100 \
  --jq '.[] | select(.pull_request | not) | {number, title, labels: [.labels[].name], closed_at, body: .body[0:600]}' \
  > /tmp/risoluto-closed-issues.json
```

Issue titles like "Slack Block Kit webhook channel" are pre-written entry names. Subagents will cross-reference these against the code they read.

### 4. Spawn one subagent per module (parallel)

For each module from Step 2, spawn a subagent using the **`extract` template** from `references/subagent-prompts.md`. Pass:
- The absolute path to the module in `$SOURCE_DIR`
- The current SHA and date
- The closed-issues JSON path (so subagents can cross-reference)
- The JSON output schema (link to `references/json-schema.md`)
- The fact-check rules so subagents don't fabricate constants

Wait for all subagents. Each returns a JSON array of feature records. If a subagent returns no features (pure plumbing module), that's a valid answer.

### 5. Merge and dedupe

Some features span multiple modules (e.g., a feature whose principal class is in `src/orchestrator/` but whose key constants live in `src/core/`). The subagent owning the principal symbol should own the entry; cross-reference shows up as a secondary citation. If two subagents both produce an entry for the same logical feature, prefer the one with the more specific symbol citation and merge the other's citations into it.

Dedupe by `id`. If two entries have different `id`s but identical citations (file + line range overlap), they're the same feature with different names — pick the name from the entry with the more user-facing description; merge citations.

### 6. Assign bundles

Apply `references/bundle-rules.md`. On a cold start you set the precedent for every future bundle decision — be deliberate. Every non-obvious bundle assignment should be recorded under `analyst_notes.bundle_fit_decisions[]`.

### 7. Seed meta sections

- **`## Summary`** — auto-derived via `scripts/render_meta.py --section summary`
- **`## Coverage manifest`** — auto-derived via `scripts/render_meta.py --section coverage --repo "$SOURCE_DIR"`. Hand-write the `note` column per row using your top-down map.
- **`## Needs follow-up`** — record every ambiguity you hit during extraction. README/spec/code drift, missing wiring, defaults that don't match docs. These become the seed list future runs will evolve.
- **`## Analyst notes`** — at minimum, populate `bundle_fit_decisions[]` with every non-obvious bundle assignment. Future runs need this to stay consistent.

### 8. Set frontmatter for cold start

```markdown
> Canonical, behavior-level, code-backed inventory of every user-observable feature and backend surface Risoluto ships today.

- **Source repo:** `risolutohq/risoluto` ([github.com/risolutohq/risoluto](https://github.com/risolutohq/risoluto))
- **Storage repo:** `risolutohq/risoluto-research` (this submodule)
- **Commit SHA:** `<source-sha>` (relative to source repo)
- **Git describe:** `<source-describe>` (default branch @ <YYYY-MM-DD>)
- **Latest shipped bundles:** <N> commits between <date-range>
- **Open roadmap features:** <count> on `risolutohq/risoluto` (as of <date>)
- **Initial cut:** This is the first spine for this repository.

> **Citation convention.** All `Source:` paths below are relative to `risolutohq/risoluto` at the SHA above. The spine itself lives in the `risolutohq/risoluto-research` submodule because that's where Risoluto's research ledger is kept. The skill auto-clones the source repo to `.spine-workspace/source/` on each run.
```

The "Initial cut" line replaces the version-drift note that appears in subsequent runs.

### 9. Resume the main pipeline

After this procedure, jump back into Step 6 (Recompute meta sections) and continue normally through Step 13.

## Time budget

A cold start on a 100+ feature codebase with parallel per-module subagents takes ~10–20 minutes wall clock. Most of that is the subagents doing source reads. The main agent stays mostly idle during the fan-out — context usage on the main agent should be under 15% even after merge.

If a single subagent times out or returns malformed JSON, re-spawn just that one — don't restart the whole run.
