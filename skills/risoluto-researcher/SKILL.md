---
name: risoluto-researcher
description: Capture external research into the `research/` vault — accept a URL plus optional raw paste (provenance), write a folder-shaped target README at `research/targets/<slug>/README.md` and one source file at `research/targets/<slug>/sources/<source-slug>.md` with pipeline-valid frontmatter, then regenerate `research/INDEX.md` as the canonical flat target list. Use this skill whenever Omer says `/risoluto-researcher`, "research this URL", "capture this article / paper / repo / talk", "add this to the research vault", "clip this into targets", or any variation that implies ingesting external content into `research/targets/`. Also trigger when Omer pastes raw text alongside a URL and wants both stored as a source entry — the skill accepts paste provenance, not just URLs. Companion to Phase 1.3 of `docs/planning-pipeline-roadmap.md`.
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

## Hard preconditions

Stop and report if any fail:

| Check                           | Command                                            | If it fails                                                                     |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Run from repo root              | `test -f package.json && test -f .gitmodules`      | Tell Omer to `cd` into the `risoluto` checkout root.                            |
| `research/` initialised         | `git submodule status research` starts with space  | Tell Omer to `git submodule update --init research` or `/init-research`.        |
| `research/templates/` present   | `test -d research/templates`                       | Tell Omer to run `/risoluto-vault` first to install templates and obsidian config. |
| `research/.schemas/` present    | `test -d research/.schemas`                        | Tell Omer to check that Phase 1.1 schemas are committed and pushed.             |

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
