# Deep GitHub capture (researcher Step 2b)

Read this only when `/risoluto-researcher` is capturing a GitHub repo URL — `source-type` is `repo` and the host is `github.com/<owner>/<repo>`. For articles, papers, talks, reddit, or X, skip it: Step 2 of `SKILL.md` already covers those.

Deep capture replaces the shallow README-only excerpt with a **code-verified** structural analysis. Three disciplines run through the whole step:

- **Read the source, don't infer from the README.** Anything you couldn't confirm in code gets marked `(inferred, not code-verified)` — see §5. An unmarked claim is a promise that you read the implementation.
- **Enumerate for recall, don't sample.** The user-facing surface is a closed set — every command, route, export, and config key is declared in a registry. Enumerate each registry and reconcile counts so coverage is checkable; don't hope to spot features by reading enough. See §4.
- **Fail soft.** A 404, a rate-limit, or a binary file is a skip-and-note, never a hard stop — see §6.

## Conditional precondition: `gh`

This is the only researcher path that needs the GitHub CLI. Verify `gh auth status` exits 0 before continuing; if it fails, tell Omer to run `gh auth login`. `gh` is deliberately **not** a global researcher precondition — non-repo captures never reach this step.

## §0 — Triage: is this repo worth deep capture?

Before cloning, pull the cheap signals from §2 metadata and decide. **Skip** (record the reason in the source body and fall back to a shallow README excerpt) if the repo is archived, empty, has fewer than ~5 commits, or has no meaningful source directory — there is nothing to leech. Depth over breadth: thoroughly documenting 3 high-value patterns beats skimming 8.

## §1 — Clone + detect the default branch

```bash
DEFAULT_BRANCH=$(gh repo view <owner>/<repo> --json defaultBranchRef --jq '.defaultBranchRef.name')
git clone --depth 1 --branch "$DEFAULT_BRANCH" <url> /tmp/researcher-<target-slug>
```

Never assume `main` — detect it (Risoluto's own peers include `master`-default repos). If the clone already exists from a previous run, `git pull` instead. The clone is ephemeral — never committed to the research vault.

A local shallow clone is preferred because it lets the agent read files directly and run `colgrep` over the source — strictly more capable than paginated API calls, and it sidesteps rate limits on large repos. If a clone is impossible (private without access, or very large), fall back to the trees API:

```bash
gh api "repos/<owner>/<repo>/git/trees/$DEFAULT_BRANCH?recursive=1" --jq '.tree[] | select(.type=="blob") | .path' | head -300
# read an individual file:
gh api repos/<owner>/<repo>/contents/<path> --jq '.content' | base64 --decode
```

## §2 — gh API metadata

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

## §3 — Read the source, in priority order

Go beyond the README — read actual implementation files, prioritised so the budget lands on the highest-signal code first:

1. **Entry points** — CLI main, `bin/`, `index.*`, app bootstrap
2. **Core logic** — orchestration, run/agent execution, task & state management
3. **Config + schemas** — validation patterns, defaults, env handling
4. **Infrastructure** — `Dockerfile`, `docker-compose.yml`, CI workflows (`.github/workflows/`)
5. **Tests** — scan structure and patterns; don't read every test file

Architecture signals to note: monorepo (workspaces / turborepo / lerna)? single binary? plugin system? Skip generated files, lock files, vendor dirs, `node_modules/`, `dist/`, and binary assets.

**If the tree is too big for one budget** (rough rule: >150 source files, or a monorepo of many packages), fan out — spawn a subagent per §4 capability area, borrowing the map-reduce pattern `risoluto-features` uses, so coverage is bounded by the registries rather than by one context window. Each subagent enumerates and reconciles its own anchor (§4) and returns its feature lines for the main agent to merge. Reading a large repo in one pass silently under-covers it — budget exhaustion is invisible, so it reads as "done" when it isn't.

## §4 — Extract features + patterns

Scan for capabilities. Frame the scan around Risoluto v1's core primitive (**the workflow run**) and the five AFK jobs — that is the lens `/risoluto-grill` will judge candidates against (`docs/product-spine.md`), so capturing in that shape makes the downstream dedup and grill cleaner:

| Capability area (≈ AFK job)        | What to look for                                                      |
| ---------------------------------- | --------------------------------------------------------------------- |
| workflow-run / orchestration model | DAG vs state machine, run lifecycle, retries, checkpointing, resume   |
| observability / trust              | run-status surfaces, structured logs, event streams, audit trails     |
| failure recovery                   | retry policy, resume-from-checkpoint, dead-letter / stall handling    |
| cost control                       | token / spend budgets, ceilings, usage metering                       |
| coordination / parallelism         | git worktrees, concurrency caps, locking, fan-out / merge             |
| review / handoff                   | PR automation, human-approval gates, diff / summary generation        |
| tracker / harness adapters         | how issue intake and agent backends are abstracted (the adapter seam) |

### Enumerate the surface — don't sample it

A repo's **user-facing** surface is a closed set: every command, route, public export, and config key is declared in one registry. That is what makes recall checkable — you are not hoping to spot features by reading enough, you are reading the list the repo already keeps. For each anchor below, **find the one registry, enumerate it completely, get the total count, then drill into each entry.** A registry of 14 commands means 14 features to account for — not "however many I happened to notice."

| Anchor (closed set)     | Registry to enumerate                                           | A complete count gives you |
| ----------------------- | --------------------------------------------------------------- | -------------------------- |
| CLI commands            | `commander`/`yargs`/`click`/`cobra` definitions, `bin/` scripts | every user-facing action   |
| API routes              | Express/FastAPI/Flask route files, `openapi.yaml`               | the whole HTTP surface     |
| Exported modules        | `index.ts`/`__init__.py`/`lib.rs` public exports                | every public capability    |
| Config schema           | `.env.example`, config types/interfaces, JSON schemas           | every configurable surface |
| Event/webhook handlers  | Files named `*handler*`, `*webhook*`, `*event*`                 | every integration point    |
| Background jobs         | Cron, queue consumers, worker files                             | every async capability     |
| Plugin/extension system | Plugin registries, middleware stacks, hook systems              | every extension seam       |

**Backend mechanics have no registry.** Retry policy, checkpointing, dispatch logic, dead-letter handling — these surface only by reading source (§3), so recall on them is best-effort, not provable. Be explicit about it: list what you found and don't imply the list is complete. This is where §0's "depth over breadth" applies — document a few high-value mechanics thoroughly rather than skim many.

### Reconcile + cross-check — the recall signal

Two cheap checks turn "did I find most of it?" from a hope into a number:

1. **Reconcile against the registry.** For each anchor, report `documented / total` — e.g. `14/14 commands`, `9/11 routes`. A gap is a _detected miss_: go capture the missing entries, or mark them `(inferred, not code-verified)`. A visible `9/11` is honest; a bare "9 routes" hides the two you skipped.
2. **Cross-check the repo's own declarations.** Diff your feature list against what the repo _advertises_ — the README / docs feature list, the repo description and topics, and recent release notes (§2). Anything advertised-but-not-found is a flagged miss, and usually points you at a registry you never located.

For each feature found, write one line: `- **Feature name** — what it does (one sentence).` Group by bundle if natural clusters emerge (e.g. "CLI", "Orchestration", "Integrations"); a flat list is fine for small repos. This is a lightweight inventory, **not** the citation-backed spine `risoluto-features` builds for Risoluto itself. The counts above are a _reconciliation, not a quota_ — find the real registry totals and report coverage against them; never pad the list to hit a number.

## §5 — Verify before you write

Before listing any feature or pattern, confirm you actually read the code that implements it. If you only saw it in the README, or inferred it from file/dir names, either go read the implementation or mark the claim `(inferred, not code-verified)` inline. `(inferred)` is a label, not an escape hatch — prefer dropping a shaky claim over shipping it unmarked. This is what keeps the candidate features the researcher hands to `/risoluto-grill` honest: the grill challenges differentiation against real peer capabilities, and a hallucinated peer feature poisons that.

## §6 — Fail soft (error handling)

- **`gh api` 404 / 403** — log it, skip that endpoint, continue. Retry at most once.
- **Rate limited (HTTP 429)** — wait 60s, retry once. If still blocked, note the gap in the body and continue with what you have.
- **Missing `docs/` / `src/` / `.github/`** — expected for many repos; adapt the reading strategy to whatever structure exists.
- **Base64 decodes to binary** — skip the file; it isn't source.

## §7 — Compose the body

Write the body file (`/tmp/researcher-<target-slug>-body.md`) with these sections:

```markdown
## Repo Overview

<gh metadata: stars, forks, language, license, created, last push, archived?>

## Architecture

<file tree summary, entry points, monorepo vs single-package, key directories>

## Features

<bullet-point features extracted from source, grouped by bundle if natural;
mark any not code-verified with (inferred, not code-verified)>

## Coverage

<recall reconciliation (§4) — one line per enumerated anchor, then the declared-surface check:

- CLI: 14/14 commands
- HTTP routes: 9/11 (2 marked inferred — see Features)
- Config keys: 22 documented
- Public exports: 8/8
- Declared-surface check: README advertises "voice mode" — not located in source (flagged)

Backend mechanics (retries, checkpointing, dispatch) are read-derived, not registry-enumerable — coverage there is best-effort, not a count.>

## Dependencies

<notable deps from package.json / equivalent — focus on framework choices, AI/LLM libs, CLI frameworks>

## Issues & Activity

<top open issues by reactions, recent merged PRs, release cadence, contributor count>

## Key Patterns

<architecture patterns observed, framed by the §4 capability areas; mark inferred claims>

## Why this matters for Risoluto

<one paragraph: which AFK job(s) does this target deepen, and what can Risoluto learn or borrow?>
```

The agent reads the actual source files to fill Architecture, Features, Dependencies, and Key Patterns — not just the README. This is the deep part. The Coverage section reports how much of each enumerable surface was accounted for (§4) — it is the recall signal that tells a later reader, and `/risoluto-grill`, how complete the inventory is.

Once the body file is written, pass it to the script via `--body-file` (Step 4 of `SKILL.md`).
