---
name: risoluto-researcher
description: Capture external research into the `research/` vault — accept a URL plus optional raw paste (provenance), write a folder-shaped target README at `research/targets/<slug>/README.md` and one source file at `research/targets/<slug>/sources/<source-slug>.md` with pipeline-valid frontmatter, then regenerate `research/INDEX.md` as the canonical flat target list. For GitHub repo URLs, performs deep capture via `gh` CLI (metadata, issues, PRs, releases, file tree, contributors, commits) — not just the README. Use this skill whenever Omer says `/risoluto-researcher`, "research this URL", "capture this article / paper / repo / talk", "add this to the research vault", "clip this into targets", or any variation that implies ingesting external content into `research/targets/`. Also trigger when Omer pastes raw text alongside a URL and wants both stored as a source entry — the skill accepts paste provenance, not just URLs. Companion to Phase 1.3 of `docs/planning-pipeline-roadmap.md`.
---

# risoluto-researcher

URL + paste capture for the Risoluto research vault. Phase 1.3 of the planning-pipeline roadmap.

## What this skill produces

When invoked with a URL (and optional pasted text), the researcher creates:

```
research/targets/<target-slug>/
├── README.md                          # target intro + link to sources
└── sources/
    └── <source-slug>.md              # raw captured material
```

And regenerates:

```
research/INDEX.md                      # flat list of every captured target
```

Every file emitted conforms to the frontmatter schemas in `research/.schemas/` (Phase 1.1) and the templates installed by `risoluto-vault` (Phase 1.2). The researcher never modifies operator-owned sections of target READMEs (see ownership table) — it only writes on first creation and updates derived fields on re-runs.

For GitHub repo URLs, the researcher also performs a shallow clone to `/tmp/researcher-<target-slug>/` for deep source analysis. The clone is ephemeral — never committed to the vault.

## Hard preconditions

Stop and report if any fail:

| Check                           | Command                                            | If it fails                                                                     |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Run from repo root              | `test -f package.json && test -f .gitmodules`      | Tell Omer to `cd` into the `risoluto` checkout root.                            |
| `research/` initialised         | `git submodule status research` starts with space  | Tell Omer to `git submodule update --init research` or `/init-research`.        |
| `research/templates/` present   | `test -d research/templates`                       | Tell Omer to run `/risoluto-vault` first to install templates and obsidian config. |
| `research/.schemas/` present    | `test -d research/.schemas`                        | Tell Omer to check that Phase 1.1 schemas are committed and pushed.             |
| `gh` CLI installed + authed     | `gh auth status` exits 0                           | Tell Omer to run `gh auth login`. Required for deep GitHub capture.             |

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

| Data | Command |
| ---- | ------- |
| Repo metadata | `gh api repos/<owner>/<repo> --jq '{name,description,language,stargazers_count,forks_count,open_issues_count,topics,license: .license.spdx_id,created_at,updated_at,pushed_at,default_branch,archived,homepage}'` |
| Languages | `gh api repos/<owner>/<repo>/languages` |
| Recent issues (top 10 open, by reactions) | `gh api 'repos/<owner>/<repo>/issues?state=open&sort=reactions&per_page=10' --jq '.[] \| {number,title,reactions: .reactions.total_count,labels: [.labels[].name],updated_at}'` |
| Recent PRs (top 10 merged) | `gh api 'repos/<owner>/<repo>/pulls?state=closed&sort=updated&per_page=10' --jq '.[] \| select(.merged_at != null) \| {number,title,merged_at,labels: [.labels[].name]}'` |
| Releases (last 5) | `gh api 'repos/<owner>/<repo>/releases?per_page=5' --jq '.[] \| {tag_name,name,published_at,body: (.body \| split("\n") \| .[0:3] \| join(" "))}'` |
| Contributors (top 10) | `gh api 'repos/<owner>/<repo>/contributors?per_page=10' --jq '.[] \| {login,contributions}'` |
| Recent commits (last 20) | `gh api 'repos/<owner>/<repo>/commits?per_page=20' --jq '.[] \| {sha: .sha[0:7], message: (.commit.message \| split("\n") \| .[0]), date: .commit.author.date}'` |

**2b.3 — Source analysis from clone**

Read from `/tmp/researcher-<target-slug>/`:

- **File tree** — top 2–3 levels (`find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -80`)
- **Dependencies** — `package.json` (deps + devDeps), `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements.txt`, or equivalent
- **Config files** — `.env.example`, `docker-compose.yml`, `Dockerfile`, CI configs (`.github/workflows/`)
- **Entry points** — `main.*`, `index.*`, `cli.*`, `bin/`, `src/cli/`, or whatever the README/docs describe as the entry
- **Test structure** — `test/`, `tests/`, `__tests__/`, `spec/` — what's tested, framework used
- **Architecture signals** — monorepo (workspaces, lerna, turborepo)? microservices? single binary? plugin system?

**2b.4 — Compose the body**

Write the body file (`/tmp/researcher-<target-slug>-body.md`) with these sections:

```markdown
## Repo Overview

<gh metadata: stars, forks, language, license, created, last push>

## Architecture

<file tree summary, entry points, monorepo vs single-package, key directories>

## Dependencies

<notable deps from package.json / equivalent — focus on framework choices, AI/LLM libs, CLI frameworks>

## Issues & Activity

<top open issues by reactions, recent merged PRs, release cadence, contributor count>

## Key Patterns

<architecture patterns observed: multi-agent, plugin system, config approach, testing strategy>

## Why this matters for Risoluto

<one paragraph: what capability does this target demonstrate? What can Risoluto learn from it?>
```

The agent reads the actual source files to fill Architecture, Dependencies, and Key Patterns — not just the README. This is the deep part.

### Step 3 — Tag ideas

Read the source content and tag the `ideas` frontmatter array. Ideas are lowercase, hyphenated capability slugs (e.g. `multi-agent-orchestration`, `cost-ceiling`). Derive them from:

- Capabilities the source explicitly demonstrates or claims
- Patterns worth tracking across multiple targets (think: what would the synthesizer cluster?)
- Leave empty `[]` if nothing jumps out — the synthesizer will suggest tags later on thin targets

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

| Flag              | Required | Description                                             |
| ----------------- | -------- | ------------------------------------------------------- |
| `--url`           | yes      | Canonical URL for the source/target                     |
| `--target-slug`   | yes      | Lowercase-hyphenated target identifier                  |
| `--category`      | yes      | `peer`, `reference`, or `adjacent`                        |
| `--source-type`   | yes      | `article`, `reddit`, `x`, `repo`, `video`, `paper`, or `talk` |
| `--source-slug`   | yes      | Lowercase-hyphenated source identifier                  |
| `--ideas`         | no       | Comma-separated idea slugs (default: empty)             |
| `--title`         | no       | Source file H1 title (default: derived from URL)        |
| `--description`   | no       | Target README description paragraph                     |
| `--body-file`     | no       | Path to a file containing the source body markdown      |
| `--dry-run`       | no       | Print what would be written, don't write anything       |

The script is idempotent per source: re-running with the same `--url` and `--source-slug` overwrites the source file, updates the target README derived fields (`last_researched_at`, `last_researched_sha`, `ideas` union, `source_count`), and regenerates INDEX.md. It never overwrites operator-owned target README prose sections.

### Step 5 — Validate

After the script runs, verify the output:

```bash
pnpm validate:research
```

If validation fails, fix the frontmatter and re-run. Common failures: missing required fields, slug pattern mismatch, invalid source_type or category enum, malformed date format.

### Step 6 — Commit

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

| Field / Section                           | Behaviour                                                       |
| ----------------------------------------- | --------------------------------------------------------------- |
| Frontmatter `slug`, `canonical_url`, `category`  | Written on first creation; **never** overwritten on re-runs     |
| Frontmatter `last_researched_at`, `last_researched_sha` | Updated every run                                              |
| Frontmatter `ideas`                      | Union of all `sources/*.md` ideas — recomputed every run        |
| Frontmatter `source_count`               | Glob of `sources/*.md` — recomputed every run                   |
| `## What is this target?`                | Written on first creation only (operator-owned after that)      |
| `## Capabilities observed`               | Written on first creation only (operator-owned after that)      |
| `## Sources`                             | Regenerated every run (lists `sources/*.md` links)              |
| `## Analyst notes`                       | **Never** touched — operator-owned                              |

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

The vault (Phase 1.2) configures the container — `.obsidian/`, templates, Dataview views. The researcher (Phase 1.3) fills the container — targets, sources, INDEX.md. Separating them keeps the vault's idempotent-apply pattern clean (it never writes content files) and lets the researcher iterate on ingestion logic without coupling to the Obsidian config surface. The only shared surface is the templates under `research/templates/` — the researcher reads them at runtime and the vault owns them canonically.

## Eval scaffolding

`evals/evals.json` holds trigger-test prompts for the description. Run skill-creator's `run_loop.py` to benchmark and tighten the description's triggering accuracy:

```bash
python -m scripts.run_loop \
  --eval-set skills/risoluto-researcher/evals/evals.json \
  --skill-path skills/risoluto-researcher \
  --model <current-model-id> \
  --max-iterations 5 \
  --verbose
```

(Run from the skill-creator root, not the risoluto root.)
