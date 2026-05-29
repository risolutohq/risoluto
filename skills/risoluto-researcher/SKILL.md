---
name: risoluto-researcher
description: 'Mode A of the Risoluto research-to-shipping pipeline. Use when Omer says /risoluto-researcher, "research this URL", "capture this article / paper / repo / talk", "add this to the research vault", "clip this into targets", or pastes text with a URL to store as a source. Captures content into `research/targets/<slug>/`, writes source files with valid frontmatter, regenerates `research/INDEX.md`, extracts candidate features, deduplicates them against roadmap rows and `RISOLUTO_FEATURES.md`, and hands survivors to /risoluto-grill. GitHub repo URLs get deeper capture via `gh` metadata and source scans.'
---

# risoluto-researcher

Mode A capture + dedup for the Risoluto research vault. Phase 1.3 / Mode A of the planning pipeline (`docs/research-to-shipping-pipeline.md`).

## What this skill produces

When invoked with a URL (and optional pasted text), the researcher creates:

```
research/targets/<target-slug>/
├── README.md                          # target intro, candidate features, leech takeaways, sources
└── sources/
    └── <source-slug>.md              # raw captured material
```

And regenerates:

```
research/INDEX.md                      # flat list of every captured target
```

Every file emitted conforms to the frontmatter schemas in `research/.schemas/` (Phase 1.1) and the templates installed by `risoluto-vault` (Phase 1.2). The researcher never modifies operator-owned sections of target READMEs (see ownership table) — it only writes on first creation and updates derived fields on re-runs.

The target README is the Mode A artifact that feeds the critic: `## Candidate features` surfaces deduped candidates for `/risoluto-grill` triage; `## Leech takeaways` records borrowable patterns independent of feature decisions.

For GitHub repo URLs, the researcher also performs a shallow clone to `/tmp/researcher-<target-slug>/` for deep source analysis. The clone is ephemeral — never committed to the vault.

## Hard preconditions

Stop and report if any fail:

| Check                         | Command                                           | If it fails                                                                        |
| ----------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Run from repo root            | `test -f package.json && test -f .gitmodules`     | Tell Omer to `cd` into the `risoluto` checkout root.                               |
| `research/` initialised       | `git submodule status research` starts with space | Tell Omer to `git submodule update --init research` or `/init-research`.           |
| `research/templates/` present | `test -d research/templates`                      | Tell Omer to run `/risoluto-vault` first to install templates and obsidian config. |
| `research/.schemas/` present  | `test -d research/.schemas`                       | Tell Omer to check that Phase 1.1 schemas are committed and pushed.                |
| `gh` CLI installed + authed   | `gh auth status` exits 0                          | Tell Omer to run `gh auth login`. Required for deep GitHub capture.                |

## The pipeline

### Step 1 — Gather inputs

The researcher accepts two forms of input:

- **URL** (required): the canonical URL for the source. This becomes both the target's `canonical_url` and the source file's `url` frontmatter.
- **Paste** (optional): raw text the operator pastes alongside the URL. Stored in the source file body. When both URL and paste are present, the source file body = paste content; the URL is fetched for the title/description only.

The agent must ask the operator for the following before running the script:

- **Target slug** — derived from the product/domain name (lowercase, hyphens). If the operator doesn't provide one, derive it from the URL: extract the significant domain segment (e.g. `cursor.com` → `cursor`, `github.com/org/repo` → `repo`).
- **Category** — `peer`, `reference`, or `adjacent`. If the operator doesn't specify, default to `peer` for competing products, `reference` for papers/docs/standards, `adjacent` for related but non-competing tools.
- **Source slug** — derived from the page title or path. If the operator doesn't provide one, derive it from the URL path's last meaningful segment (e.g. `/blog/multi-agent-architecture` → `multi-agent-architecture`).
- **Source type** — one of `article|reddit|x|repo|video|paper|talk`. If the operator doesn't specify, infer from the URL (github.com → `repo`, youtube.com → `video`, arxiv.org → `paper`, reddit.com → `reddit`, x.com/twitter.com → `x`; otherwise `article`).

### Step 2 — Fetch the URL and extract content

Fetch the URL content (use a web fetch tool). From the response, extract:

- **Title** — `<title>` tag, `og:title`, or first `<h1>`. Used as the source file's H1.
- **Excerpt** — clean the fetched text, distill it into a short excerpt (<200 words) for the source body. If a paste was provided, the paste IS the body — the URL fetch is only used for title/metadata.
- **Description** (for the target README) — one paragraph: what the target is, what it ships, why Risoluto tracks it.

### Step 2b — Deep GitHub Capture (repo sources only)

When `source-type` is `repo` and the URL is a GitHub repo (`github.com/<owner>/<repo>`), perform deep capture. This replaces the shallow README-only excerpt with a full structural analysis.

**2b.1 — Shallow clone**

```bash
git clone --depth 1 <url> /tmp/researcher-<target-slug>
```

If the clone already exists from a previous run, `git pull` instead. The clone is ephemeral — never committed to the research vault.

**2b.2 — gh API metadata**

Run these `gh` commands against `<owner>/<repo>`:

| Data                                      | Command                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo metadata                             | `gh api repos/<owner>/<repo> --jq '{name,description,language,stargazers_count,forks_count,open_issues_count,topics,license: .license.spdx_id,created_at,updated_at,pushed_at,default_branch,archived,homepage}'` |
| Languages                                 | `gh api repos/<owner>/<repo>/languages`                                                                                                                                                                           |
| Recent issues (top 10 open, by reactions) | `gh api 'repos/<owner>/<repo>/issues?state=open&sort=reactions&per_page=10' --jq '.[] \| {number,title,reactions: .reactions.total_count,labels: [.labels[].name],updated_at}'`                                   |
| Recent PRs (top 10 merged)                | `gh api 'repos/<owner>/<repo>/pulls?state=closed&sort=updated&per_page=10' --jq '.[] \| select(.merged_at != null) \| {number,title,merged_at,labels: [.labels[].name]}'`                                         |
| Releases (last 5)                         | `gh api 'repos/<owner>/<repo>/releases?per_page=5' --jq '.[] \| {tag_name,name,published_at,body: (.body \| split("\n") \| .[0:3] \| join(" "))}'`                                                                |
| Contributors (top 10)                     | `gh api 'repos/<owner>/<repo>/contributors?per_page=10' --jq '.[] \| {login,contributions}'`                                                                                                                      |
| Recent commits (last 20)                  | `gh api 'repos/<owner>/<repo>/commits?per_page=20' --jq '.[] \| {sha: .sha[0:7], message: (.commit.message \| split("\n") \| .[0]), date: .commit.author.date}'`                                                  |

**2b.3 — Source analysis from clone**

Read from `/tmp/researcher-<target-slug>/`:

- **File tree** — top 2–3 levels (`find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -80`)
- **Dependencies** — `package.json` (deps + devDeps), `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`, or equivalent
- **Config files** — `.env.example`, `docker-compose.yml`, `Dockerfile`, CI configs (`.github/workflows/`)
- **Entry points** — `main.*`, `index.*`, `cli.*`, `bin/`, `src/cli/`, or whatever the README/docs describe as the entry
- **Test structure** — `test/`, `tests/`, `__tests__/`, `spec/` — what's tested, framework used
- **Architecture signals** — monorepo (workspaces, lerna, turborepo)? microservices? single binary? plugin system?

**2b.3b — Feature extraction (80/20)**

Extract a lightweight feature inventory from the clone. This is NOT the full citation-backed spine that `risoluto-features` produces for Risoluto itself — it's a quick scan for user-observable and backend-surface features. Extract what's there — no numeric target.

Common signals to scan (not exhaustive — follow anything else that reveals capabilities):

| Signal                  | Where to look                                                   | What it reveals       |
| ----------------------- | --------------------------------------------------------------- | --------------------- |
| CLI commands            | `commander`/`yargs`/`click`/`cobra` definitions, `bin/` scripts | User-facing actions   |
| API routes              | Express/FastAPI/Flask route files, `openapi.yaml`               | HTTP surface          |
| Exported modules        | `index.ts`/`__init__.py`/`lib.rs` public exports                | Core capabilities     |
| Config schema           | `.env.example`, config types/interfaces, JSON schemas           | Configurable surfaces |
| Event/webhook handlers  | Files named `*handler*`, `*webhook*`, `*event*`                 | Integration points    |
| Background jobs         | Cron, queue consumers, worker files                             | Async capabilities    |
| Plugin/extension system | Plugin registries, middleware stacks, hook systems              | Extensibility         |

For each feature found, write one line: `- **Feature name** — what it does (one sentence).`

Group features by bundle if natural clusters emerge (e.g. "CLI", "API", "Integrations", "Orchestration"). Don't force grouping — a flat list is fine for small repos.

**2b.4 — Compose the body**

Write the body file (`/tmp/researcher-<target-slug>-body.md`) with these sections:

```markdown
## Repo Overview

<gh metadata: stars, forks, language, license, created, last push>

## Architecture

<file tree summary, entry points, monorepo vs single-package, key directories>

## Features

<bullet-point features extracted from source, grouped by bundle if natural>

## Dependencies

<notable deps from package.json / equivalent — focus on framework choices, AI/LLM libs, CLI frameworks>

## Issues & Activity

<top open issues by reactions, recent merged PRs, release cadence, contributor count>

## Key Patterns

<architecture patterns observed: multi-agent, plugin system, config approach, testing strategy>

## Why this matters for Risoluto

<one paragraph: what capability does this target demonstrate? What can Risoluto learn from it?>
```

The agent reads the actual source files to fill Architecture, Features, Dependencies, and Key Patterns — not just the README. This is the deep part.

### Step 3 — Tag ideas

Read the source content and tag the `ideas` frontmatter array. Ideas are lowercase, hyphenated capability slugs (e.g. `multi-agent-orchestration`, `cost-ceiling`). Derive them from:

- Capabilities the source explicitly demonstrates or claims
- Patterns worth tracking across multiple targets (think: what would the ingest pass cluster?)
- Leave empty `[]` if nothing jumps out — the ingest pass will suggest tags later on thin targets

### Step 4 — Run the researcher script

The agent collects all gathered information and invokes the deterministic script:

```bash
node skills/risoluto-researcher/scripts/research.mjs \
  --url "https://..." \
  --target-slug "example-product" \
  --category "peer" \
  --source-type "article" \
  --source-slug "feature-thread" \
  --ideas "multi-agent,cost-ceiling" \
  --title "The page title" \
  --description "One paragraph about the target" \
  --body-file "/tmp/researcher-body.md"
```

All flags:

| Flag            | Required | Description                                                   |
| --------------- | -------- | ------------------------------------------------------------- |
| `--url`         | yes      | Canonical URL for the source/target                           |
| `--target-slug` | yes      | Lowercase-hyphenated target identifier                        |
| `--category`    | yes      | `peer`, `reference`, or `adjacent`                            |
| `--source-type` | yes      | `article`, `reddit`, `x`, `repo`, `video`, `paper`, or `talk` |
| `--source-slug` | yes      | Lowercase-hyphenated source identifier                        |
| `--ideas`       | no       | Comma-separated idea slugs (default: empty)                   |
| `--title`       | no       | Source file H1 title (default: derived from URL)              |
| `--description` | no       | Target README description paragraph                           |
| `--body-file`   | no       | Path to a file containing the source body markdown            |
| `--dry-run`     | no       | Print what would be written, don't write anything             |

The script is idempotent per source: re-running with the same `--url` and `--source-slug` overwrites the source file, updates the target README derived fields (`last_researched_at`, `last_researched_sha`, `ideas` union, `source_count`), and regenerates INDEX.md. It never overwrites operator-owned target README prose sections.

### Step 5 — Mode A dedup workflow

After the script writes the target README, the agent fills `## Candidate features` and `## Leech takeaways` directly in the README. This is an agent edit, not a script — no roadmap.mjs import needed.

**5.1 — Extract candidate features**

Read the source body (the captured content from Step 2 / 2b). For each distinct user-observable or backend-surface feature the target ships, write one bullet in `## Candidate features`, tagging the AFK job it serves — the value lens, one of `observability-trust`, `failure-recovery`, `cost-control`, `coordination-parallelism`, `review-handoff` (see `docs/product-spine.md`). A feature that serves no AFK job is a shiny object — record it under `## Leech takeaways` instead of as a candidate:

```
- <Feature name> — <one-line description> [job: <afk-job>] [flag: TBD]
```

**5.2 — Deduplicate each candidate**

For each candidate bullet, compare it against:

1. `docs/roadmap.md` — the `## The plan` table. Read each row's `Item` cell (the slug is in the HTML comment `<!-- slug:<slug> -->`).
2. `research/RISOLUTO_FEATURES.md` — the current feature spine for Risoluto itself.

Assign the dedup flag:

| Flag        | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `new`       | No overlap with any roadmap row or spine entry → surface to `/risoluto-grill`  |
| `merge`     | Overlaps with an existing roadmap row → name the row slug                      |
| `supersede` | Replaces a roadmap row that should be dropped or rewritten → name the row slug |
| `skip`      | Already shipped by Risoluto, or fully covered by an existing spine entry       |

**Dedup at the job layer too, not only the feature layer.** Feature-level matching misses _saturation_: two differently-worded features can serve a job Risoluto already covers. After assigning the per-feature flag, check the candidate's `[job:]` against shipped features and open rows serving that same job — if the job is already covered for this use-case, the candidate is `merge` (fold into the row that owns the job) or `skip`, not `new`, even when the feature wording is novel. Jobs are the real unit; features are how they surface.

Update each bullet's `[flag: TBD]` with the correct flag (and the matched row slug for `merge`/`supersede`). Example:

```
- Cost ceiling per run — cap spend before a workflow run starts [job: cost-control] [flag: new]
- Live log streaming — stream stdout from running tasks [job: observability-trust] [flag: merge slug:live-log-streaming]
- Polling-based run status — long-poll HTTP endpoint for run status [job: observability-trust] [flag: skip]
```

**5.3 — Fill Leech takeaways**

In `## Leech takeaways`, record what to borrow from this target even if none of its features become roadmap rows — framing, patterns, UX decisions, naming conventions. One bullet per takeaway:

```
- <pattern or UX decision> — <why it's worth borrowing>
```

**5.4 — Hand off to /risoluto-grill**

Collect all `[flag: new]` and `[flag: merge]` candidates. Pass the target slug to `/risoluto-grill` with a reference to the README path so the critic can triage survivors. Only `new` and `merge` candidates need critic review — `supersede` candidates need a separate founder decision before the row is touched; `skip` candidates are done.

Skills propose; the founder disposes: never reorder, promote, or delete roadmap rows. Only append `idea` rows via the grill output.

### Step 6 — Validate

After the script runs and the dedup edits are in place, verify the output:

```bash
pnpm validate:research
```

If validation fails, fix the frontmatter and re-run. Common failures: missing required fields, slug pattern mismatch, invalid source_type or category enum, malformed date format.

### Step 7 — Commit

The `research/` submodule has its own git history. Commit there first, then bump the parent:

```bash
cd research
git add targets/ INDEX.md
git commit -m "research: capture <target-slug> via risoluto-researcher"
git push
cd ..
git add research
git commit -m "chore: bump research submodule for <target-slug> capture"
```

## Target README ownership (what the script touches on re-runs)

| Field / Section                                         | Behaviour                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Frontmatter `slug`, `canonical_url`, `category`         | Written on first creation; **never** overwritten on re-runs |
| Frontmatter `last_researched_at`, `last_researched_sha` | Updated every run                                           |
| Frontmatter `ideas`                                     | Union of all `sources/*.md` ideas — recomputed every run    |
| Frontmatter `source_count`                              | Glob of `sources/*.md` — recomputed every run               |
| `## What is this target?`                               | Written on first creation only (operator-owned after that)  |
| `## Capabilities observed`                              | Written on first creation only (operator-owned after that)  |
| `## Candidate features`                                 | Written on first creation only (operator-owned after that)  |
| `## Leech takeaways`                                    | Written on first creation only (operator-owned after that)  |
| `## Sources`                                            | Regenerated every run (lists `sources/*.md` links)          |
| `## Analyst notes`                                      | **Never** touched — operator-owned                          |

## INDEX.md regeneration

On every run, the script regenerates `research/INDEX.md` from the filesystem:

```
# Research Index

| Target | Category | Sources | Last Researched | Ideas |
| ------ | -------- | ------- | --------------- | ----- |
| cursor | peer     | 3       | 2026-05-26      | multi-agent, inline-diff |
| aider  | peer     | 2       | 2026-05-25      | architect-mode, voice |
```

This is the canonical flat list for agents, CI, `cat`, and `git log` — complementary to the Dataview views `risoluto-vault` installs.

## Smoke test

Given one URL, the researcher produces a target README + one source file that pass `pnpm validate:research`:

```bash
# Dry-run first
node skills/risoluto-researcher/scripts/research.mjs \
  --url "https://cursor.com" \
  --target-slug "cursor" \
  --category "peer" \
  --source-type "article" \
  --source-slug "homepage" \
  --title "Cursor — The AI Code Editor" \
  --description "Cursor is an AI-first code editor built on VS Code. It ships inline multi-model chat, whole-codebase context, and agent-driven refactoring. We track it because it defines the current ceiling for AI-assisted coding UX." \
  --body-file /dev/null \
  --dry-run

# Apply for real (omit --dry-run)
node skills/risoluto-researcher/scripts/research.mjs \
  --url "https://cursor.com" \
  --target-slug "cursor" \
  --category "peer" \
  --source-type "article" \
  --source-slug "homepage" \
  --title "Cursor — The AI Code Editor" \
  --description "Cursor is an AI-first code editor built on VS Code. It ships inline multi-model chat, whole-codebase context, and agent-driven refactoring. We track it because it defines the current ceiling for AI-assisted coding UX." \
  --body-file /dev/null

# Validate
pnpm validate:research
# Expected: "validate:research: N file(s) OK."
```

## Why this skill is separate from `risoluto-vault`

The vault (Phase 1.2) configures the container — `.obsidian/`, templates, Dataview views. The researcher (Phase 1.3) fills the container — targets, sources, INDEX.md — and runs the Mode A dedup workflow that surfaces candidates to `/risoluto-grill`. Separating them keeps the vault's idempotent-apply pattern clean (it never writes content files) and lets the researcher iterate on ingestion logic without coupling to the Obsidian config surface. The vault owns `research/templates/` canonically (apply.mjs deploys them); the researcher does NOT read them at runtime — buildTargetBody and buildSourceBody are self-contained string builders.
