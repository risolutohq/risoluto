# Research → Shipping Pipeline

> How a **roadmap item becomes merged code** — and how raw research becomes a roadmap item.
> The one ordered plan is [`roadmap.md`](./roadmap.md); this doc covers the full funnel from
> two structured research modes down to shipped code, with Linear as the planning↔runtime seam.
>
> Decisions: [`adr/0001-foundation.md` §7](./adr/0001-foundation.md#7-research-to-shipping-planning-pipeline)
>
> - decisions [#29](./decisions.md) (the pipeline) and [#30](./decisions.md) (the roadmap-centric model).

## Mental model

```
 MODE A — Targeted adoption          MODE B — Sense-making / innovation
┌──────────────────────────┐        ┌──────────────────────────────────┐
│  /risoluto-researcher    │        │  /risoluto-ingest                │
│  research/targets/<slug> │        │  reads ALL research/targets/     │
│  Candidate features      │        │  builds research/wiki/ (wikilinks│
│  + Leech takeaways       │        │  targets together)               │
│        │                 │        │  gap-grounded cite-or-drop ideas │
│        ▼ dedup           │        │        │                         │
│  skip|merge|supersede|new│        │        ▼ gap-grounded ideas only │
│        │ (new only)      │        └────────┼─────────────────────────┘
│        ▼                 │                 │
│  /risoluto-grill         │                 │
│  (critic loop)           │                 │
│  founder decides in/out  │                 │
└──────────┬───────────────┘                 │
           │  roadmap idea rows              │  roadmap idea rows
           └──────────────┬──────────────────┘
                          ▼
              ┌───────────────────────┐
              │    docs/roadmap.md    │  ← FOUNDER-OWNED: ranks, promotes, kills
              │    one ordered list   │    Skills only APPEND (status: idea)
              │    slug is join key   │
              └───────────┬───────────┘
                          │  next row
                          ▼  SHARED BACK-HALF — proven engine
              ┌───────────────────────┐
              │    /risoluto-to-prd   │  PRD in git + Linear project
              └───────────┬───────────┘
                          │  git is canon; drift hook blocks divergence
                          ▼
              ┌───────────────────────┐
              │  /risoluto-to-issues  │  flat Linear issues, blocked-by edges
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │   /risoluto-tdd       │  red-green-refactor; prints gh pr create
              └───────────┬───────────┘
                          ▼  ADVISORY (not blocking)
              ┌───────────────────────┐
              │  /risoluto-pre-pr     │  wraps /code-review + /simplify,
              │                       │  then a mandatory /v1-check;
              └───────────┬───────────┘  founder applies selectively
                          ▼
                        merge
                          │
                          ▼  RECORD (post-merge automation, only on merges to master)
              back-comment Linear issues (idempotent, marker-deduped)
              flip PRD status → shipped; flip roadmap row → shipped
              print "run /risoluto-features" (manual refresh — CI does NOT auto-refresh)
              reconcile issue status/ACs via /risoluto-sync (CI does NOT flip issue status)
```

### Principle: Skills propose; the founder disposes

The roadmap is **founder-owned**. Skills (`/risoluto-ingest`, `/risoluto-grill`) may append proposed
rows at `status: idea` — they never reorder, promote, or delete rows. A row only advances when the
founder edits it.

## Surfaces

| Surface                           | Role                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/roadmap.md`](./roadmap.md) | **The plan.** Founder-owned ordered list; top non-shipped row is next. Slug is the join key.                                                         |
| `research/targets/`               | Per-source capture: `README.md` with Candidate features + Leech takeaways, plus source files.                                                        |
| `research/wiki/`                  | Connected knowledge base built by `/risoluto-ingest`. Wikilinks targets into a big picture.                                                          |
| `research/RISOLUTO_FEATURES.md`   | Canonical inventory of shipped features. Refreshed **manually** via `/risoluto-features` (post-merge prints the reminder; it does not auto-refresh). |
| `research/` submodule             | Houses all of the above plus the Obsidian vault and `.schemas/`.                                                                                     |
| `docs/prds/`                      | Canonical PRD files (git). Linear project content bodies are generated mirrors.                                                                      |
| Linear                            | Canonical implementation planning: projects + flat issues with blocked-by.                                                                           |
| `docs/`                           | Current-truth product / technical / decision docs.                                                                                                   |

Git is the source of truth for PRDs; Linear mirrors them. No GitHub Issues mirror (public exposure
deferred). Linear → git only flows for the PRD drift hook and PR back-comments.

## Prerequisites

```bash
git submodule status research          # leading space = ok; "-" = run the next line
git submodule update --init research   # or invoke /init-research
node -v && pnpm -v                     # Node 22+, pnpm 11
[ -n "$LINEAR_API_KEY" ] && echo ok || echo "set LINEAR_API_KEY first"
```

`LINEAR_API_KEY` is required for `to-prd`, `to-issues`, `tdd`, `prd:drift-check`, post-merge, and any
`mcp__linear-server__*` call. The Linear MCP server is configured in `.mcp.json`.

## The two research modes

### Mode A — Targeted adoption (build path)

Run when studying a specific source: a repo, an X thread, a blog post, a paper.

1. **Researcher** (`/risoluto-researcher <url>`) deep-analyzes the source and writes
   `research/targets/<slug>/README.md` with:
   - What the source is and its observed capabilities.
   - `## Candidate features` — per-feature candidates for Risoluto.
   - `## Leech takeaways` — what to borrow (framing, patterns, UX).

2. **Dedup** — each candidate is checked against (a) existing roadmap rows and
   (b) `research/RISOLUTO_FEATURES.md` (already-shipped features). Each candidate gets a flag:

   | Flag        | Meaning                                                           | Action                                          |
   | ----------- | ----------------------------------------------------------------- | ----------------------------------------------- |
   | `skip`      | Already shipped (in FEATURES) or already covered by a roadmap row | Drop it — no new row.                           |
   | `merge`     | Overlaps an existing `idea`/`next` row                            | Fold the takeaway into that row; no new row.    |
   | `supersede` | A better/newer version of an existing row                         | Mark the old row `superseded`; add the new row. |
   | `new`       | No overlap                                                        | Proceeds to critic-grill.                       |

3. **Critic-grill** (`/risoluto-grill`) — each surviving `new` candidate runs an admission loop:
   **two gates, a router, two ordering-only scores** (full logic in the skill):
   - **Gate 1 — thesis alignment**: does it deepen one of the five AFK jobs (`product-spine.md` value
     lens)? No named job → dropped (cite-or-drop, not scored low).
   - **Router — classification** (`differentiator` | `table_stakes` | `nice_to_have`): selects which
     justification standard applies.
   - **Gate 2 — class-specific justification**: differentiator → a falsifiable bet; table-stakes →
     category credibility (absence is a hole); nice-to-have → cited, dated demand, else dropped.
   - **Scores (ordering only)**: cost/complexity + reversibility set rank and thinnest cut, never
     admission. The founder decides in/out per candidate.

4. **Kept candidates** become roadmap rows (`status: idea` or `next`) whose Research link points to
   `research/targets/<slug>/README.md`. The founder ranks.

### Mode B — Sense-making / innovation (run anytime)

Run to find white-space ideas across all accumulated research, or to keep the connected wiki current.

1. **Ingest** (`/risoluto-ingest`) reads **all** `research/targets/**/README.md` plus their sources
   and builds a **connected wiki** at `research/wiki/`: a home note plus concept notes that wikilink
   targets together — the big picture.

2. **Gap-grounded idea generation** — an idea is only emitted if it **cites the dots it connects,
   the gap it fills, and the AFK job it serves** (`product-spine.md` value lens). Required patterns:
   "A, B, C all do X but none do Y" or "A's X + B's Y compose into Z". No citation, or no AFK job →
   the idea is **dropped** (cite-or-drop).

3. **Generated white-space ideas** land as roadmap rows (`status: idea`) whose Research link cites
   the wiki note or targets they connect. They enter the same funnel → critic-grill → founder ranks.

Ingest is **idempotent and non-interactive** — run it anytime to refresh the wiki and surface new ideas.

> **Why the wiki matters.** Risoluto's concept (multi-agent orchestration + background/AFK agents +
> workflow-centric state-machine/DAG) is novel. A tidy connected knowledge base is the moat and the
> substrate the idea-engine mines.

## The stages

| #   | Stage               | Invoke                             | Reads                                               | Writes                                                                                                 | Owner    |
| --- | ------------------- | ---------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| A1  | Research (Mode A)   | `/risoluto-researcher <url>`       | a URL (+ optional paste)                            | `research/targets/<slug>/README.md` + sources; INDEX                                                   | operator |
| A2  | Dedup               | operator reviews candidates        | target README + roadmap + RISOLUTO_FEATURES         | flags on each candidate (skip/merge/supersede/new)                                                     | operator |
| A3  | Critic-grill        | `/risoluto-grill`                  | surviving `new` candidates + roadmap + product docs | roadmap idea rows for kept candidates                                                                  | operator |
| B1  | Ingest (Mode B)     | `/risoluto-ingest`                 | all `research/targets/` + sources                   | `research/wiki/` (home + concept notes); roadmap idea rows                                             | operator |
| 0   | Plan                | edit [`roadmap.md`](./roadmap.md)  | roadmap idea rows + judgement                       | a roadmap row promoted to `next` (has Why + Size)                                                      | operator |
| 1   | To-PRD              | `/risoluto-to-prd <slug>`          | the `next` roadmap row + its linked research        | `docs/prds/<slug>.md`, Linear project, branch `pipeline/…`                                             | operator |
| 1.3 | Drift gate          | `pnpm prd:drift-check`             | PRD body vs Linear                                  | exit 1 on drift — also in `.husky/pre-push`                                                            | gate     |
| 2   | To-issues           | `/risoluto-to-issues <slug>`       | `docs/prds/<slug>.md` + roadmap row                 | Linear issues labelled `from:prd-<slug>`, blocked-by edges                                             | operator |
| 2.5 | Preflight (gate)    | `/risoluto-preflight <slug>`       | PRD + `from:prd-<slug>` issues + env                | GO/NO-GO verdict; roadblockers disposed (interactive)                                                  | operator |
| 3   | TDD                 | `/risoluto-tdd <ticket-ref>`       | Linear issue + linked PRD                           | code + tests; prints `gh pr create`                                                                    | operator |
| 3.5 | Advisory review     | `/risoluto-pre-pr`                 | the diff / PR                                       | findings; founder applies selectively                                                                  | operator |
| 3.6 | AC verify (x-model) | `/risoluto-verify-acceptance <t>`  | issue ACs + branch diff + tests                     | per-criterion MET/NOT_MET verdict (opencode, different model)                                          | operator |
| 4   | Post-merge (CI)     | `post-merge.yml` (auto, →master)   | merged PR with `from:prd-<slug>` label              | PRD `status: shipped`; idempotent back-comments; roadmap flipped; prints `/risoluto-features` reminder | CI       |
| 4.5 | Sync (reconcile)    | `/risoluto-sync <slug>`            | `from:prd-<slug>` issues + git merge state          | issue Done + AC ticks from proof; drift report                                                         | operator |
| 5   | Record              | ADR + `decisions.md` + roadmap row | the shipped decision                                | an ADR/decision entry                                                                                  | operator |

## Walkthrough

```bash
# MODE A — Targeted adoption
/risoluto-researcher https://example.com   # deep-analyze a source; GitHub URLs get gh capture
# Review research/targets/<slug>/README.md; run dedup against roadmap + RISOLUTO_FEATURES
/risoluto-grill                            # critic-grill surviving new candidates; founder decides in/out
# Kept candidates are appended to docs/roadmap.md at status: idea; founder ranks

# MODE B — Sense-making (run anytime, idempotent)
/risoluto-ingest                           # rebuilds research/wiki/ + emits gap-grounded idea rows
# Review roadmap.md for new idea rows; promote/kill/rank

# PROMOTE an idea row to next: add Why + Size in docs/roadmap.md
$EDITOR docs/roadmap.md

# BACK-HALF — shared for all next rows
# 1. Promote the `next` row to a PRD + Linear project.
/risoluto-to-prd <slug>                    # CREATE first run; SYNC on re-run (git → Linear)
#  → to-prd reads the roadmap row AND its linked research (Research link cell)
#  → flips the roadmap row next → building; stamps linear_project into the row
pnpm validate:research                     # PRD frontmatter validates (exit 0)

# 2. Slice into issues, implement test-first.
/risoluto-to-issues <slug>                 # PRD → flat Linear issues, blocked-by inferred (review the graph)
/risoluto-tdd RSL-123                      # validates blocked-by are Done; red-green-refactor; prints `gh pr create`

# ADVISORY — founder applies findings selectively, not a blocking gate.
/risoluto-pre-pr                           # code-review → triage → simplify → mandatory v1-check; reprints `gh pr create`

# 3. On merge TO MASTER (post-merge.yml is base-branch-gated), it automatically:
#    - back-comments Linear issues (idempotent — marker-deduped)
#    - flips PRD status → shipped
#    - flips the roadmap row → shipped
#    - prints "ACTION REQUIRED: run /risoluto-features" — the FEATURES refresh is MANUAL, not CI
#    It does NOT flip Linear issue status; run /risoluto-sync <slug> to reconcile issue Done + AC ticks.
#    Then: record the decision in ADR + decisions.md if notable.
```

## Roadmap row spec

The roadmap uses exactly **6 columns**:

```
| # | Item | Why now | Size | Status | Research link |
```

- **`#`** — priority number; order is priority; top non-shipped row is "what is next".
- **`Item`** — short title. A row that has entered the pipeline carries its slug as a trailing HTML
  comment: `Title <!-- slug:<slug> -->`. The slug is the join key (roadmap row ↔ PRD filename ↔
  `prd.slug` frontmatter ↔ `from:prd-<slug>` Linear label).
- **`Why now`** — the reason to do it now. Empty → the row cannot leave `idea`. For a `dropped` row
  this cell carries the kill reason (there is no separate Notes column).
- **`Size`** — `S` / `M` / `L` (rough effort). Empty → the row cannot leave `idea`.
- **`Status`** — one of the status vocab below. Once `building`/`shipped` this cell may be a link,
  e.g. `[building](<linear_project_url>)`.
- **`Research link`** — backlink to what motivated the row: `research/targets/<slug>/README.md`,
  a `research/wiki/<note>.md`, or an em-dash for pure-judgement rows.

### Status vocab

| Status       | Meaning                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `idea`       | Named (founder- or skill-proposed); needs Why + Size before promotion.                                                              |
| `next`       | Scoped (has Why + Size) and ranked to start soon; has or is about to get a PRD.                                                     |
| `building`   | A PRD exists and Linear issues are in flight (`from:prd-<slug>`).                                                                   |
| `shipped`    | Merged in the canonical repo.                                                                                                       |
| `dropped`    | Killed; the reason is written in the Why now cell. Never silently removed.                                                          |
| `superseded` | Replaced by a newer row/feature (set by dedup `supersede`); the superseding row/feature is named.                                   |
| `deprecated` | Shipped surface marked for removal — unused or not worth its complexity cost (the [exit gate](#exit-gate-pruning-shipped-surface)). |

## PRD contract (git is canon)

Each `docs/prds/<slug>.md` is the **authoritative** copy; the Linear Project content body is a
generated mirror pushed by `/risoluto-to-prd`. `/risoluto-to-prd` reads the `next` roadmap row
**and its linked research** (Research link cell) to draft the PRD.

Linear has two relevant Project fields:

- `description` — the short Project overview text. Keep this to a one-sentence summary.
- `content` — the full markdown body shown in Linear's Description area. This mirrors the full PRD
  body from git.

- **Do not edit the Linear Project Description body in the UI.** The drift hook is intentional friction; treat Linear content as generated from git.
- **Resolve drift** by choosing a direction:
  - _Git is right_ → re-run `/risoluto-to-prd <slug>` (idempotent; overwrites Linear from git).
  - _Linear is right_ → `pnpm prd:reconcile <slug>` (pulls Linear → git on a branch; prints `gh pr create`).

## The drift gate

`prd:drift-check` compares each PRD body against its Linear Project content and fails on divergence.
It runs in `.husky/pre-push` (only for pushes that touch `docs/prds/*`) and in the
`prd-drift` GitHub Action on PRs. `LINEAR_API_KEY` unset = hard exit 1 (it does not silently pass).

## Frontmatter contract

JSON Schemas live under `research/.schemas/` and are checked by `pnpm validate:research`.
`prd.schema.json` exists — `validate:research` covers `docs/prds/*`.

```yaml
# docs/prds/<slug>.md
slug: <slug>
linear_project: https://linear.app/<org>/project/<name>-<slugId>
synced_at: <ISO-8601>
source: docs/roadmap.md#<slug>   # the roadmap row this PRD came from
status: draft | approved | shipped | archived

# research/targets/<slug>/README.md   (capture only)
slug: <target-slug>
canonical_url: https://...
category: peer | reference | adjacent
last_researched_at: 2026-05-29
source_count: <int>
```

- **`additionalProperties: true`** on every research schema — `research/` is also an Obsidian vault,
  so Web Clipper / Templater / operator fields pass through untouched.
- **`research/wiki/` notes are freeform** — not frontmatter-validated. They are authored by
  `/risoluto-ingest` as Obsidian-compatible markdown with wikilinks.
- **Slug consistency** — `pnpm slug:check` (`scripts/slug-consistency-check.mjs`, wired into pre-push)
  verifies the slug is identical across the PRD file name, `prd.slug` frontmatter, and the roadmap row
  `<!-- slug:<slug> -->`; `--linear` additionally reports whether the `from:prd-<slug>` label exists.

## Linear as the memory layer

Linear is the pipeline's shared memory across stages — but **git is canon**. Each back-half skill reads
and writes Linear at defined moments; nothing is lost between stages if each writes its slice:

| Skill                     | Reads (Linear)                           | Writes (Linear)                                                  |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `to-issues`               | existing `from:prd-<slug>` issues        | issues, blocked-by/related, 5 labels, wave milestones            |
| `tdd`                     | issue desc + ACs + blocked-by states     | status→In Progress (claim); AC ticks from proof; PR back-comment |
| `goal-run` (merge agent)  | live blocked-by states                   | status→Done on merge; merge back-comment                         |
| `review-handoff`          | issues + ACs + states                    | review summary comment on the tracking issue                     |
| `verify-acceptance`       | issue ACs                                | (optional) cross-model verdict comment                           |
| `sync`                    | all `from:prd-<slug>` issues + git state | reconciles status→Done + AC ticks from proof; drift report       |
| `post-merge-prd.mjs` (CI) | `from:prd-<slug>` issues                 | idempotent merge back-comment (does **not** flip issue status)   |

Invariants:

- **Git is canon; Linear mirrors.** Every Linear write traces to git truth + proof. Resolve PRD drift with
  `prd:reconcile` (Linear→git) or `to-prd` sync (git→Linear).
- **Status Done is written only by the merger** — the conductor's merge agent, or the operator /
  `/risoluto-sync` — always from a merged branch + proof, never from a green suite.
- **Comments are idempotent** via the `<!-- risoluto:<kind>[:<key>] -->` marker convention.
- **`/risoluto-sync` is the backstop** that repairs any missed status flip or AC tick and reports drift
  (merged-but-Todo, Done-with-empty-ACs, ticked-without-proof, `discovered` issues orphaned from `WAVES.md`).
- **Access asymmetry (intentional):** `to-prd` uses direct Linear GraphQL because the MCP `save_project`
  surface cannot set the Project `content` field; the issue-level skills use the Linear MCP. Both bindings
  live in `skills/references/linear-access.md`.

## Back-half AFK conductor

Before launching an autonomous build, run **`/risoluto-preflight <slug>`** — the interactive roadblocker
gate that clears missing env/secrets, non-falsifiable ACs, unresolved blocked-by, missing test infra, and
scope conflicts (incl. `discovered` issues orphaned from `WAVES.md`). `goal-prep`'s "runner readiness" is a
status print, not this gate.

Phase 4.0 starts after `/risoluto-to-issues <slug>` has created Linear issues and build-wave milestones.
`/risoluto-goal-prep <slug>` renders a runner-agnostic launch package into `~/.risoluto/goals/<slug>/` from git + Linear:

- `WAVES.md` freezes Linear milestones as the wave map.
- `GOAL.md` is the runner-neutral conductor prompt (goal-forge block shape) for the deterministic cascade.
- `CONTROL.md`, `PLAN.md`, `ATTEMPTS.md`, and `NOTES.md` are the conductor's process state.

The same package runs three ways: **Codex** goal-forge (`/goal`); **`/risoluto-goal-run`**, the
Claude-native runner that drives the cascade via the Workflow tool (waves sequential, ready issues within a
wave built in parallel in isolated worktrees, journaled + resumable); or a plain **Claude Code** session that
follows `GOAL.md` sequentially. They are not identical engines (Codex is a durable goal loop; the Workflow
runner adds parallel fan-out and resume; the plain session is the simplest single-threaded path). The generated goal uses one
`integration/<slug>` branch. Each wave branches from the current integration tip, issue worktrees branch from
the active wave, and merges flow issue -> wave -> integration. Waves are not parallel siblings off master.

A wave that cannot drain — a build that stays red after one repair, a merge needing ownership judgment, a
null gate result from budget/context exhaustion — is a **hard stop**: the conductor journals the blocker to
`PLAN.md`/`ATTEMPTS.md` and halts the cascade at that wave (it does not skip the issue), and the returned
summary names the blocking wave and reason. A `discovered` issue filed mid-build is not in the frozen
`WAVES.md`; re-run `/risoluto-goal-prep` to fold it into a wave before it can be built.

Phase 4.4 is `/risoluto-review-handoff <slug>`: a different model reviews `integration/<slug>` against the
PRD and Linear issues, writes `review-handoff.v1` to `~/.risoluto/goals/<slug>/REVIEW.md`, and comments the
summary in Linear. The conductor (Codex or Claude Code) then resumes the `/goal`, fixes findings, re-runs
`/v1-check`, and prints the PR command. Skills do not run `gh pr create`.

## Invariants & gotchas

- **The roadmap is the only plan.** No second backlog, no auto-generated idea ledger. If it isn't a roadmap row, it isn't planned.
- **Slug is the join key.** Carried as `<!-- slug:<slug> -->` in the roadmap Item cell; identical across roadmap row / PRD file + frontmatter / Linear project / `from:prd-<slug>` label. `pnpm slug:check` enforces this (pre-push + on demand; `--linear` cross-checks the label).
- **Skills propose; the founder disposes.** Skills append `idea` rows — they never reorder, promote, or delete rows.
- **Value lens + fit are both gates, not scores.** A candidate earns a row only if it deepens one of the five AFK jobs (`product-spine.md`) _and_ composes with the spine — alignment is a hard cite-or-drop gate. Classification (`differentiator` / `table_stakes` / `nice_to_have`) _routes_ which justification standard applies; cost + reversibility are ordering scores only, never admission.
- **Acceptance is the red-test spec.** Each issue criterion is a falsifiable behavioural assertion `/risoluto-tdd` turns into a failing test — never a restatement of the global gate (build/lint/test/typecheck/coverage). A slice with no falsifiable behaviour is not ready to start.
- **Intake is gated; so is exit.** Pruning shipped surface is a first-class move — see the exit gate below. `deprecated` retires live capability that stopped earning its keep; `superseded` only retires a row a newer row replaces.
- **Git is canon for PRDs.** Resolve divergence with `prd:reconcile` (Linear → git) or `to-prd` sync (git → Linear). Never hand-edit Linear Project content.
- **No auto-PR (hook-enforced).** Skills branch, commit, and push but never run `gh pr create` — they print it. A `PreToolUse(Bash)` guard (`.claude/hooks/guard-pipeline.sh`) deterministically denies the agent running `gh pr create`/`gh pr merge` and force-push, so the invariant no longer rides on model judgment.
- **Linear field split.** Project `description` is only the short overview; the generated PRD mirror lives in Project `content`.
- **Advisory stage, mandatory inner gate.** `/risoluto-pre-pr` (Stage 3.5) is advisory as a whole — the founder may skip the stage — but **if it runs and changes code, its `/v1-check` is mandatory**: it never reprints the PR command over a red or unrun gate. Don't conflate the two levels (skippable stage, blocking inner gate).
- **Idempotent:** researcher, ingest, vault, to-prd sync, next-bundle, `risoluto-sync`, `risoluto-preflight`, `risoluto-verify-acceptance`. **Not idempotent (each has a Step 0 reconcile — reconcile before re-running):** to-issues, tdd. **Partial:** to-prd CREATE (refuses if the PRD/branch exists), pre-pr (re-commits on re-run), goal-prep `--force` (wipes resume state), goal-run cold re-run (resume with `resumeFromRunId`).

## Exit gate: pruning shipped surface

Every stage above gates what comes **in** (researcher → dedup → grill → cite-or-drop → thesis). For a
tool whose dominant failure mode is complexity, an unguarded **exit** is the bigger risk — there must
be a path to _remove_ shipped surface, not only add it. `superseded` only retires a row a newer row
replaces; it does not retire live capability that simply stopped earning its keep.

- **`deprecated` status** marks a shipped capability slated for removal. A removal is planned like any
  other work: the `deprecated` row carries the reason (unused / cost > value) in its Why now cell and
  flows through the same back-half (PRD → issues → TDD) to delete the surface _and its tests_.
- **Usage signal on `RISOLUTO_FEATURES.md`.** The post-merge step already regenerates the feature
  inventory; it is the natural place to hang a "last exercised in a real run" signal. A periodic
  review flags features with no recent usage as `deprecated` candidates — pruning becomes a gate, not
  an afterthought. (The usage-tracking mechanism is runtime telemetry, not yet built; this documents
  the gate so the signal has a home once runs emit it.)

## Known gaps

Confirmed in code:

1. **`to-issues` is not idempotent** — re-running after a PRD change can duplicate Linear issues.
   Mitigation: Step 0 — Reconcile (operator-gated, not mechanical).
2. **`tdd` is not idempotent** — a partial re-run can collide on the worktree/branch and leave the ticket
   In Progress. Mitigation: `tdd` Step 0 — Reconcile resumes or cleans the prior state before re-running.
3. **Linear comments have no native dedup** — every automated comment now carries a
   `<!-- risoluto:<kind>[:<key>] -->` marker, and writers skip when a comment with that marker already
   exists (`scripts/post-merge-prd.mjs`; by convention `tdd` / `goal-run` / `review-handoff` /
   `risoluto-sync`).
4. **CI does not reconcile issue status** — `post-merge-prd.mjs` flips PRD + roadmap status and
   back-comments, but never flips Linear issue status. Run `/risoluto-sync <slug>` to reconcile issue
   Done + acceptance ticks from git truth + proof. See [Linear as the memory layer](#linear-as-the-memory-layer).

## Skills

Pipeline skills live in `skills/risoluto-*/` and are symlinked into `.claude/skills/` and
`.agents/skills/`:

| Skill                        | Mode / role                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `risoluto-researcher`        | Mode A step 1 — deep-analyzes a source; writes `research/targets/<slug>/README.md`.                                                                                                                                                   |
| `risoluto-grill`             | Mode A step 3 — the critic; grill-loops surviving candidates; founder decides in/out per candidate.                                                                                                                                   |
| `risoluto-ingest`            | Mode B — the reborn synthesizer; builds `research/wiki/` + emits gap-grounded idea rows.                                                                                                                                              |
| `risoluto-to-prd`            | Back-half — reads a `next` roadmap row + its linked research; writes PRD + Linear project.                                                                                                                                            |
| `risoluto-to-issues`         | Back-half — slices a PRD into flat Linear issues with blocked-by edges.                                                                                                                                                               |
| `risoluto-tdd`               | Back-half — red-green-refactor against a Linear ticket; prints `gh pr create`.                                                                                                                                                        |
| `risoluto-verify-acceptance` | Back-half — per-issue cross-model (opencode) acceptance-criteria gate; MET/NOT_MET verdict, distinct from review-handoff.                                                                                                             |
| `risoluto-next-bundle`       | Back-half scheduler — filters Linear issues to the ready-set + emits conflict-free bundles for parallel worktrees.                                                                                                                    |
| `risoluto-preflight`         | Back-half gate (before AFK) — interactive roadblocker interview; GO/NO-GO before goal-prep/goal-run.                                                                                                                                  |
| `risoluto-goal-prep`         | Back-half AFK conductor generator (Phase 4.0) — derives waves from a PRD's Linear milestones; writes a runner-agnostic `/goal` package (Codex or Claude Code) into `~/.risoluto/goals/<slug>/`.                                       |
| `risoluto-goal-run`          | Back-half AFK conductor runner (Phase 4.0, Claude-only) — drives a goal package as a wave cascade via the Workflow tool: waves sequential, ready issues within a wave built in parallel in isolated worktrees, journaled + resumable. |
| `risoluto-review-handoff`    | Back-half end-review (Phase 4.4) — a different model reviews `integration/<slug>`; emits `review-handoff.v1` for the `/goal` conductor loop (Codex or Claude Code) to ingest and fix.                                                 |
| `risoluto-sync`              | Back-half memory-layer reconciler — flips merged issues Done + ticks ACs from proof, reports Linear drift. The backstop for missed status flips.                                                                                      |
| `risoluto-vault`             | Obsidian vault helper; unaffected by pipeline changes.                                                                                                                                                                                |

**Fork-not-upgrade.** `to-prd`, `to-issues`, and `tdd` are Linear-specific forks of the global
`~/.claude/skills/{to-prd,to-issues,tdd}` — invoke the namespaced `/risoluto-*` variants here. The
global skills stay tracker-agnostic. `grill-me`, `grill-with-docs`, `save-to-obsidian` are used as-is.

## Not in scope

- **General bidirectional Linear ↔ git sync.** PRD content has explicit git ↔ Linear reconciliation; the rest of the pipeline only mirrors git → Linear and PR → Linear back-comments.
- **No GitHub Issues mirror.** Linear is the sole planning surface; public exposure deferred.
- **Product runtime auto-pickup.** Risoluto itself still does not auto-consume tracker tickets as a shipped
  product surface. The AFK back-half is an operator-launched build conductor (Codex or Claude Code) that
  consumes a prepared PRD's Linear issues under `~/.risoluto/goals/<slug>/`.
- **Pipeline as a Risoluto Workflow Definition.** This is the operator's manual build tool, not a product surface — it is not destined to run inside Risoluto.

## Reference

**Scripts:** `scripts/validate-research.ts`, `scripts/prd-drift-check.ts`, `scripts/prd-reconcile.ts`,
`scripts/prd-linear.ts`, `scripts/post-merge-prd.mjs`.
**Key files:** [`docs/roadmap.md`](./roadmap.md), `docs/prds/`, `research/targets/`, `research/wiki/`,
`docs/adr/0001-foundation.md` (§7).

## Troubleshooting

| Symptom                               | Cause / fix                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `validate:research` fails early       | `research/` submodule not initialized — `git submodule update --init research`.                   |
| `prd:drift-check` exits 1 "hard gate" | `LINEAR_API_KEY` unset — export it (or set the GH secret for CI).                                 |
| `prd:drift-check` reports DRIFT       | PRD body and Linear content diverged — `prd:reconcile <slug>` or `to-prd <slug>` to sync.         |
| Post-merge didn't flip status         | PR lacked the `from:prd-<slug>` label, or a Linear call failed (flip is skipped).                 |
| `risoluto-ingest` emits no ideas      | All generated ideas lacked citations — cite-or-drop is enforced. Add more research targets first. |
