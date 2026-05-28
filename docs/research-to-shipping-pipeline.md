# Research → Shipping Pipeline — How To Use It

> Operator guide for running the Risoluto planning pipeline end to end: from capturing external
> research to shipping merged code, with Linear as the planning/runtime seam.
>
> This is the **how-to**. The canonical _decisions_ live in
> [`adr/0007-research-to-shipping-pipeline.md`](./adr/0007-research-to-shipping-pipeline.md)
> (decisions.md row #29). The roadmap (`planning-pipeline-roadmap.md`) is historical record only.

## Mental model

External signal becomes shipped code by passing through five stages. **One slug is the join key**
the whole way — pick it once at synthesis and it names the idea folder, the backlog row, the PRD
file, the Linear project, and the `from:prd-<slug>` issue label.

```
 capture        cluster          scope            publish              implement          record
┌──────────┐   ┌────────────┐   ┌────────┐   ┌──────────────────┐   ┌───────────────┐   ┌────────┐
│ RESEARCH │──▶│ SYNTHESIZE │──▶│ GRILL  │──▶│ TO-PRD           │──▶│ TO-ISSUES     │──▶│ RECORD │
│ targets/ │   │ ideas/ +   │   │ why-us │   │ docs/prds/<slug> │   │ + TDD         │   │ ADR /  │
│ sources/ │   │ backlog    │   │ + shape│   │ + Linear project │   │ + POST-MERGE  │   │ decis. │
└──────────┘   └────────────┘   └────────┘   └────────┬─────────┘   └───────────────┘   └────────┘
   1.x             2.x             3.1          3.2    │  3.3 drift gate   4.1 / 4.2 / 4.3     5.x
                                                       ▼
                                                  git is canon; Linear mirrors;
                                                  prd:drift-check blocks divergence
```

**Surfaces:** CLI/skills are primary. Git is the source of truth for PRDs; Linear is a mirror and
the planning/runtime seam. The web frontend, dashboard, and docs-site are out of scope.

## Prerequisites

```bash
# 1. research/ submodule must be initialized (every stage reads/writes it)
git submodule status research          # leading space = ok; leading "-" = run the next line
git submodule update --init research   # or invoke the /init-research skill

# 2. Node 22+ and pnpm 11
node -v && pnpm -v

# 3. LINEAR_API_KEY exported in your shell (required for to-prd, drift-check, post-merge, MCP)
#    Also set as the GitHub repo secret LINEAR_API_KEY for the post-merge workflow.
[ -n "$LINEAR_API_KEY" ] && echo "Linear token present" || echo "set LINEAR_API_KEY first"
```

The Linear MCP server (`linear-server`) is configured in `.mcp.json`; the grill/to-prd/to-issues
skills call `mcp__linear-server__*` tools. The pipeline skills are symlinked into `.claude/skills/`
and `.agents/skills/`, so Claude Code and Codex discover them by trigger phrase.

## The stages

| #   | Stage      | Invoke                                  | Reads                          | Writes                                                       | Owner    |
| --- | ---------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------ | -------- |
| 1.2 | Vault      | `/risoluto-vault`                       | `research/`                    | `research/.obsidian/`, templates, Dataview views             | tooling  |
| 1.3 | Capture    | `/risoluto-researcher <url>`            | a URL (+ optional paste)       | `research/targets/<slug>/README.md` + `sources/*.md`, INDEX  | operator |
| 2.1 | Synthesize | `/risoluto-synthesizer`                 | all `targets/*/` `ideas:` tags | `research/ideas/<slug>/README.md`, backlog `idea` rows       | tooling  |
| 3.1 | Grill      | `/risoluto-grill <slug>`                | idea README + evidence         | `## Why us / why now` + `## Smallest shippable shape`        | operator |
| 3.2 | To-PRD     | `/risoluto-to-prd <slug>`               | grilled idea README            | `docs/prds/<slug>.md`, Linear project, branch `pipeline/...` | operator |
| 3.3 | Drift gate | `pnpm prd:drift-check`                  | PRD body vs Linear             | (exit 1 on drift) — also runs in `.husky/pre-push`           | gate     |
| 4.1 | To-issues  | `/risoluto-to-issues <slug>`            | `docs/prds/<slug>.md`          | Linear issues labelled `from:prd-<slug>`                     | operator |
| 4.2 | TDD        | `/risoluto-tdd <ticket-ref>`            | Linear issue + linked PRD      | code + tests; PR; `from:prd-<slug>` label on the PR          | operator |
| 4.3 | Post-merge | CI (`.github/workflows/post-merge.yml`) | merged PR with the label       | flips PRD `status: shipped` + back-comments Linear           | CI       |
| 5.x | Record     | ADR + `docs/decisions.md`               | the shipped decision           | an ADR entry + a decisions row                               | operator |

## Walkthrough

### 1. Capture research

```bash
# Configure the vault once (idempotent; safe to re-run to repair drift)
/risoluto-vault

# Capture a competitor / article / paper / repo. GitHub URLs get deep gh capture.
/risoluto-researcher https://example.com
# → research/targets/<slug>/README.md and sources/<source>.md, then INDEX.md is regenerated

pnpm validate:research   # frontmatter must validate against research/.schemas/*.json (exit 0)
```

Tag sources with `ideas: [<idea-slug>]` in their frontmatter — that tag is what the synthesizer
clusters on.

### 2. Synthesize into idea clusters

```bash
/risoluto-synthesizer    # full-corpus, idempotent
```

Groups every tagged target/source into `research/ideas/<slug>/README.md` (synthesizer-owned
sections) and writes the `status: idea` rows of `docs/capability-backlog.md` between its
`BEGIN/END risoluto-synthesizer:idea-rows` markers. It never clobbers operator-owned prose or an
operator-set `ready`/`in-flight`/`shipped` status.

### 3. Grill, then promote to a PRD

```bash
/risoluto-grill <slug>   # one question at a time; fills the two operator-owned sections
```

On exit it writes `## Why us / why now` and `## Smallest shippable shape` and offers to flip the
backlog row `idea → ready`.

```bash
/risoluto-to-prd <slug>
```

- **First run (CREATE):** writes `docs/prds/<slug>.md`, creates a Linear project mirroring the PRD
  body, pushes branch `pipeline/<slug>-prd`, and stamps `linear_project` + `prd_file` into the idea
  README frontmatter. **Then paste the Linear UI banner** (template in
  [`prds/README.md`](./prds/README.md)) into the new project's description.
- **Re-run (SYNC):** overwrites the Linear project description from the current PRD (git is canon).
- The skill stops short of `gh pr create` — it **prints** the command for you to run.

### 3.3 The drift gate

Git is canonical; Linear mirrors it. `prd:drift-check` compares each PRD body against its Linear
project description and fails if they diverge (it only compares the first 255 chars — Linear's
description summary cap).

```bash
pnpm prd:drift-check -- --all     # CI / pre-push mode: check every PRD
# Drift detected? choose a direction:
pnpm prd:reconcile <slug>         # adopt the Linear edit back into git (branch pipeline/<slug>-prd-reconcile)
/risoluto-to-prd <slug>           # or overwrite Linear from git (sync)
```

This also runs automatically in `.husky/pre-push`. `LINEAR_API_KEY` is a **hard gate**: if it is
unset the check exits 1 (it does not silently pass).

### 4. Issues, implementation, post-merge

```bash
/risoluto-to-issues <slug>        # PRD → flat Linear issues labelled from:prd-<slug>, blocked-by inferred
/risoluto-tdd <ticket-ref>        # e.g. RSL-123: validates blocked-by are Done, runs red-green-refactor,
                                  # back-comments the PR, applies the from:prd-<slug> label, prints `gh pr create`
```

When a PR carrying the `from:prd-<slug>` label is **merged**, `.github/workflows/post-merge.yml`
runs `scripts/post-merge-prd.mjs`: it back-comments the linked Linear issues with the PR, then flips
the PRD frontmatter to `status: shipped` (the disk write is the last step, after the Linear calls
succeed). Requires the `LINEAR_API_KEY` repo secret.

### 5. Record the decision

Add an ADR under `docs/adr/` and a row to `docs/decisions.md` when a capability ships and the
decision is worth preserving. ADR-0007 is the record for this pipeline itself.

## Invariants & gotchas

- **Slug is the join key.** Keep it identical across idea/backlog/PRD/Linear/label. No ad-hoc
  variants.
- **Idempotent.** Researcher, synthesizer, vault, and to-prd sync are safe to re-run; a second run
  repairs/updates derived fields without clobbering operator prose. There is no "slug already
  exists" halt.
- **Git is canon for PRDs.** Linear is a mirror; resolve divergence with `prd:reconcile` (Linear →
  git) or `to-prd` sync (git → Linear).
- **No auto-PR.** Skills branch, commit, and push but never run `gh pr create` — they print it.
- **`LINEAR_API_KEY` required** for to-prd, drift-check, post-merge, and any `mcp__linear-server__*`
  call. Unset = hard gate (exit 1).
- **255-char Linear cap.** Drift detection only sees the first 255 chars of the PRD body; content
  past that is git-only and never drifts.
- **Operator banner.** After a CREATE-mode to-prd, paste the banner from `prds/README.md` into the
  new Linear project description.

## Reference

**Skills** (`skills/risoluto-*/`, symlinked into `.claude/skills/` and `.agents/skills/`):
`risoluto-vault`, `risoluto-researcher`, `risoluto-synthesizer`, `risoluto-grill`,
`risoluto-to-prd`, `risoluto-to-issues`, `risoluto-tdd`.

**Scripts:** `scripts/validate-research.ts` (`pnpm validate:research`),
`scripts/prd-drift-check.ts` (`pnpm prd:drift-check`), `scripts/prd-reconcile.ts`
(`pnpm prd:reconcile`), `scripts/prd-linear.ts` (Linear GraphQL helpers),
`scripts/post-merge-prd.mjs` (CI post-merge automation).

**Key files:** `research/targets/`, `research/ideas/`, `research/INDEX.md`,
`docs/capability-backlog.md`, `docs/prds/`, `docs/adr/0007-research-to-shipping-pipeline.md`.

## Troubleshooting

| Symptom                                      | Cause / fix                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Any skill or `validate:research` fails early | `research/` submodule not initialized — `git submodule update --init research`.     |
| `prd:drift-check` exits 1 "hard gate"        | `LINEAR_API_KEY` is unset — export it (or set the GH secret for CI).                |
| `prd:drift-check` reports DRIFT              | PRD body and Linear diverged — `prd:reconcile <slug>` or `to-prd <slug>` to sync.   |
| `pre-push` blocked                           | A PRD drifted — resolve drift, or fix the failing gate step it reports.             |
| Post-merge didn't flip status                | PR lacked the `from:prd-<slug>` label, or the Linear call failed (flip is skipped). |
