# Research → Shipping Pipeline

> How a single **roadmap item becomes merged code**. The one ordered plan is
> [`roadmap.md`](./roadmap.md); this doc is how a `next` row travels from plan to shipped, with Linear
> as the planning↔runtime seam. **Research is an optional upstream input, not a parallel plan.**
>
> Decisions: [`adr/0001-foundation.md` §7](./adr/0001-foundation.md#7-research-to-shipping-planning-pipeline)
>
> - decisions [#29](./decisions.md) (the pipeline) and [#30](./decisions.md) (the roadmap-centric reset).

## Mental model

```
 (optional input)            THE PLAN                  THE ENGINE — proven back-half
┌──────────┐              ┌─────────────┐   ┌───────┐   ┌──────────┐   ┌────────┐   ┌─────┐
│ RESEARCH │── fold by ──▶│ roadmap.md  │──▶│ GRILL │──▶│  TO-PRD  │──▶│ ISSUES │──▶│ TDD │──▶ merge ──▶ shipped
│ targets/ │    hand      │ one ordered │   │(opt.) │   │ PRD+Linear│   │+blocked│   │ R-G │            ──▶ record
└──────────┘              │ list+status │   └───────┘   └────┬─────┘   └────────┘   └─────┘
                          └─────────────┘                    │ git is canon
                                                              ▼ prd:drift-check blocks divergence
```

- The **roadmap** is the spine and the single source of "what's next" — hand-owned, ordered, one file.
- **Research** (`/risoluto-researcher`) is optional: study peers or a problem space, then fold what matters into a roadmap row **yourself**. It no longer auto-generates the plan.
- The **back-half** (`to-prd → to-issues → tdd → post-merge`) is the proven engine that turns a `next` row into shipped code. Planning is heavy/human; implementation treats the Linear ticket as the unit of work. CLI/skills are the surface; no web frontend.

## Wiring status — read this first

The roadmap-centric model above is the **target** ([decision #30](./decisions.md)). The skills were
built against the old `capability-backlog.md` + `research/ideas/` model, which the reset removed.
**Until Phase C rewires them, these skills break or misbehave** because their inputs are gone:

| Skill                  | Old input (now removed)                        | Phase-C rewire                               |
| ---------------------- | ---------------------------------------------- | -------------------------------------------- |
| `risoluto-synthesizer` | _wrote_ `capability-backlog.md` idea-rows      | **retire** — the roadmap is hand-owned       |
| `risoluto-grill`       | read backlog row + `research/ideas/<slug>/`    | read a roadmap row                           |
| `risoluto-to-prd`      | read `research/ideas/<slug>/` + backlog row    | read a roadmap row; `source_idea` → `source` |
| `risoluto-to-issues`   | read backlog row for the bundle-category label | derive category from the roadmap row / PRD   |

`risoluto-researcher`, `risoluto-vault`, `risoluto-tdd`, and the drift / post-merge scripts are
unaffected.

## Surfaces

| Surface                           | Role                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------- |
| [`docs/roadmap.md`](./roadmap.md) | **The plan.** One hand-owned ordered list; top non-shipped row is next.       |
| `research/` submodule             | Optional research capture + the Obsidian vault + `RISOLUTO_FEATURES.*`.       |
| `docs/prds/`                      | Canonical PRD files (git). Linear project descriptions are generated mirrors. |
| Linear                            | Canonical implementation planning: projects + flat issues with blocked-by.    |
| `docs/`                           | Current-truth product / technical / decision docs.                            |

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

## The stages

| #   | Stage          | Invoke                                 | Reads                     | Writes                                                           | Owner    |
| --- | -------------- | -------------------------------------- | ------------------------- | ---------------------------------------------------------------- | -------- |
| 0   | Plan           | edit [`roadmap.md`](./roadmap.md)      | your judgement + research | a roadmap row (`idea` → `next` once it has Why + Size)           | operator |
| 1   | Research (opt) | `/risoluto-researcher <url>`           | a URL (+ optional paste)  | `research/targets/<slug>/` + sources; INDEX                      | operator |
| 2   | Grill (opt)    | `/risoluto-grill` / `/grill-with-docs` | a roadmap row + canon     | sharper scope; updated `docs/*` / a new ADR if canon shifts      | operator |
| 3   | To-PRD         | `/risoluto-to-prd <slug>`              | the `next` roadmap row    | `docs/prds/<slug>.md`, Linear project, branch `pipeline/…`       | operator |
| 3.3 | Drift gate     | `pnpm prd:drift-check`                 | PRD body vs Linear        | exit 1 on drift — also in `.husky/pre-push`                      | gate     |
| 4.1 | To-issues      | `/risoluto-to-issues <slug>`           | `docs/prds/<slug>.md`     | Linear issues labelled `from:prd-<slug>`, blocked-by edges       | operator |
| 4.2 | TDD            | `/risoluto-tdd <ticket-ref>`           | Linear issue + linked PRD | code + tests; PR; `from:prd-<slug>` label; prints `gh pr create` | operator |
| 4.3 | Post-merge     | CI (`post-merge.yml`)                  | merged PR with the label  | flips PRD `status: shipped` + back-comments Linear               | CI       |
| 5   | Record         | ADR + `decisions.md` + roadmap row     | the shipped decision      | an ADR/decision entry; roadmap row → `shipped`                   | operator |

## Walkthrough

```bash
# 0. Plan — add/raise a roadmap row. It only reaches `next` with a Why + a Size.
$EDITOR docs/roadmap.md

# 1. (optional) Research a peer/problem and fold the takeaway into the roadmap row yourself.
/risoluto-researcher https://example.com   # GitHub URLs get deep gh capture
pnpm validate:research                      # frontmatter must validate (exit 0)

# 2. (optional) Sharpen scope before committing to a PRD.
/risoluto-grill <slug>                      # one question at a time
/grill-with-docs                            # only if the item touches/extends existing canon

# 3. Promote the `next` row to a PRD + Linear project.
/risoluto-to-prd <slug>                     # CREATE first run; SYNC on re-run (git → Linear)
#  → paste the Linear UI banner (see "PRD contract") into the new project description
#  → the skill prints `gh pr create`; you open the PR

# 4. Slice into issues, implement test-first.
/risoluto-to-issues <slug>                  # PRD → flat Linear issues, blocked-by inferred (review the graph)
/risoluto-tdd RSL-123                        # validates blocked-by are Done; red-green-refactor; prints `gh pr create`

# 5. On merge, post-merge.yml flips the PRD to shipped + back-comments Linear.
#    Then: flip the roadmap row to `shipped` and record the decision if notable.
```

## PRD contract (git is canon)

Each `docs/prds/<slug>.md` is the **authoritative** copy; the Linear project description is a
generated mirror pushed by `/risoluto-to-prd`. Linear caps descriptions at 255 chars, so the mirror
is only the **first 255 chars** of the PRD body — content past that lives only in git, and the drift
hook only protects the prefix.

- **Do not edit Linear project descriptions in the UI.** The drift hook is intentional friction; treat the description as generated content.
- **Resolve drift** by choosing a direction:
  - _Git is right_ → re-run `/risoluto-to-prd <slug>` (idempotent; overwrites Linear from git).
  - _Linear is right_ → `pnpm prd:reconcile <slug>` (pulls Linear → git on a branch; prints `gh pr create`).
- **Linear UI banner** — paste below the synced body so anyone in Linear sees the edit path:

  ```
  ---
  > This description is generated from `docs/prds/<slug>.md` in git.
  > Edit via a PR against the source file; UI edits are overwritten on
  > the next sync and blocked by the pre-push drift hook.
  ---
  ```

## The drift gate

`prd:drift-check` compares each PRD body against its Linear project description and fails on
divergence. It runs in `.husky/pre-push` (only for pushes that touch `docs/prds/*`) and in the
`prd-drift` GitHub Action on PRs. `LINEAR_API_KEY` unset = hard exit 1 (it does not silently pass).

## Frontmatter contract

JSON Schemas live under `research/.schemas/` and are checked by `pnpm validate:research`.

```yaml
# docs/prds/<slug>.md
slug: <slug>
linear_project: https://linear.app/<org>/project/<name>-<slugId>
synced_at: <ISO-8601>
source: docs/roadmap.md#<slug> # the roadmap row this PRD came from
status: draft | approved | shipped | archived

# research/targets/<slug>/README.md   (capture only; optional)
slug: <target-slug>
canonical_url: https://...
category: peer | reference | adjacent
last_researched_at: 2026-05-29
source_count: <int>
```

- **`additionalProperties: true`** on every research schema — `research/` is also an Obsidian vault, so Web Clipper / Templater / operator fields pass through untouched.
- **PRD frontmatter still has no schema** (`prd.schema.json`) and `validate:research` does not cover `docs/prds/*` — a known gap (below).

## Invariants & gotchas

- **The roadmap is the only plan.** No second backlog, no auto-generated idea ledger. If it isn't a roadmap row, it isn't planned.
- **Slug is the join key.** Identical across roadmap row / PRD file + frontmatter / Linear project / `from:prd-<slug>` label. One typo silently breaks the chain — not yet enforced (gap below).
- **Git is canon for PRDs.** Resolve divergence with `prd:reconcile` (Linear → git) or `to-prd` sync (git → Linear). Never hand-edit Linear descriptions.
- **No auto-PR.** Skills branch, commit, and push but never run `gh pr create` — they print it.
- **255-char Linear cap.** Drift detection sees only the first 255 chars of the PRD body.
- **Idempotent:** researcher, vault, to-prd sync. **Not idempotent:** to-issues, tdd (re-runs can duplicate).

## Known gaps (Phase C candidates)

Confirmed in code; not yet fixed:

1. **Drift is shallow** — only the first 255 chars are compared. A full-body `synced_hash` in PRD frontmatter would close it.
2. **`to-issues` is not idempotent** — re-running after a PRD change can duplicate Linear issues.
3. **No `prd.schema.json`** — PRD frontmatter is unvalidated by `validate:research`.
4. **Slug not enforced** — nothing checks the join key is identical across roadmap/PRD/Linear/label.
5. **Roadmap row not auto-closed** — post-merge flips the PRD to `shipped` but not the roadmap row; close it by hand at stage 5 until wired.

## Skills

Pipeline skills live in `skills/risoluto-*/` and are symlinked into `.claude/skills/` and
`.agents/skills/`: `risoluto-vault`, `risoluto-researcher`, `risoluto-synthesizer` (being retired),
`risoluto-grill`, `risoluto-to-prd`, `risoluto-to-issues`, `risoluto-tdd`.

**Fork-not-upgrade.** `to-prd`, `to-issues`, and `tdd` are Linear-specific forks of the global
`~/.claude/skills/{to-prd,to-issues,tdd}` — invoke the namespaced `/risoluto-*` variants here. The
global skills stay tracker-agnostic. `grill-me`, `grill-with-docs`, `save-to-obsidian` are used as-is.

## Not in scope

- **Bidirectional Linear ↔ git sync.** Only git → Linear (on to-prd/to-issues create) and PR → Linear back-comment ship.
- **No GitHub Issues mirror.** Linear is the sole planning surface; public exposure deferred.
- **Runtime auto-pickup.** Auto-consuming Linear tickets is parked behind the `auto:runtime` label seam; this pipeline stops at manual `/risoluto-tdd <ticket-ref>`.
- **Pipeline as a Risoluto Workflow Definition.** This is the operator's manual build tool, not a product surface — it is not destined to run inside Risoluto.

## Reference

**Scripts:** `scripts/validate-research.ts`, `scripts/prd-drift-check.ts`, `scripts/prd-reconcile.ts`,
`scripts/prd-linear.ts`, `scripts/post-merge-prd.mjs`.
**Key files:** [`docs/roadmap.md`](./roadmap.md), `docs/prds/`, `research/targets/`,
`docs/adr/0001-foundation.md` (§7).

## Troubleshooting

| Symptom                                   | Cause / fix                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| A skill reads a missing backlog/idea path | Pre-Phase-C wiring — the skill still points at the removed backlog. See Wiring status. |
| `validate:research` fails early           | `research/` submodule not initialized — `git submodule update --init research`.        |
| `prd:drift-check` exits 1 "hard gate"     | `LINEAR_API_KEY` unset — export it (or set the GH secret for CI).                      |
| `prd:drift-check` reports DRIFT           | PRD body and Linear diverged — `prd:reconcile <slug>` or `to-prd <slug>` to sync.      |
| Post-merge didn't flip status             | PR lacked the `from:prd-<slug>` label, or a Linear call failed (flip is skipped).      |
