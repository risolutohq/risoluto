# Research → Shipping Pipeline

> The single operator guide for Risoluto's planning pipeline: from capturing external research to
> shipping merged code, with Linear as the planning/runtime seam.
>
> Canonical _decisions_ live in [`adr/0001-foundation.md` §7](./adr/0001-foundation.md#7-research-to-shipping-planning-pipeline)
> (decisions.md row #29). This file is the operational reference — how to run it, the file
> contracts, and who owns what.

## Mental model

External signal becomes shipped code by passing through six stages. **One slug is the join key**
the whole way — pick it once at synthesis and it names the idea folder, the backlog row, the PRD
file, the Linear project, and the `from:prd-<slug>` issue label.

```
 capture        cluster          scope            publish              implement          record
┌──────────┐   ┌────────────┐   ┌────────┐   ┌──────────────────┐   ┌───────────────┐   ┌────────┐
│ RESEARCH │──▶│ SYNTHESIZE │──▶│ GRILL  │──▶│ TO-PRD           │──▶│ TO-ISSUES     │──▶│ RECORD │
│ targets/ │   │ ideas/ +   │   │ why-us │   │ docs/prds/<slug> │   │ + TDD         │   │ ADR /  │
│ sources/ │   │ backlog    │   │ + shape│   │ + Linear project │   │ + POST-MERGE  │   │ decis. │
└──────────┘   └────────────┘   └────────┘   └────────┬─────────┘   └───────────────┘   └────────┘
   1.x             2.x          3.1 / 3.1.5     3.2    │  3.3 drift gate   4.1 / 4.2 / 4.3     5.x
                                                       ▼
                                                  git is canon; Linear mirrors;
                                                  prd:drift-check blocks divergence
```

**Two stages, one seam.** Planning (heavy: research → synthesize → grill → PRD → issues) is mostly
text and decisions; implementation (lighter: the TDD loop per ticket) treats the Linear ticket as
the unit of work. CLI/skills are the primary surface; the web frontend, dashboard, and docs-site
are out of scope.

## Surfaces

| Surface                      | Role                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `research/` submodule        | Per-target capture, idea clusters, and the Obsidian vault. Operator intel.     |
| `docs/capability-backlog.md` | Living idea ledger. Synthesizer writes `idea` rows; operator promotes/drops.   |
| `docs/prds/`                 | Canonical PRD files (git). Linear project descriptions are generated mirrors.  |
| Linear                       | Canonical planning for implementation: projects + flat issues with blocked-by. |
| `docs/`                      | Current-truth product / technical / decision docs.                             |
| `~/Documents/my-vault/`      | Operator's personal Obsidian vault — separate from `research/`.                |

Git is the source of truth for PRDs; Linear mirrors it. No GitHub Issues mirror for now (public
exposure deferred). Linear → git only flows for the PRD drift hook and PR back-comments.

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

| #     | Stage      | Invoke                                  | Reads                          | Writes                                                       | Owner    |
| ----- | ---------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------ | -------- |
| 1.2   | Vault      | `/risoluto-vault`                       | `research/`                    | `research/.obsidian/`, templates, Dataview views             | tooling  |
| 1.3   | Capture    | `/risoluto-researcher <url>`            | a URL (+ optional paste)       | `research/targets/<slug>/README.md` + `sources/*.md`, INDEX  | operator |
| 2.1   | Synthesize | `/risoluto-synthesizer`                 | all `targets/*/` `ideas:` tags | `research/ideas/<slug>/README.md`, backlog `idea` rows       | tooling  |
| 3.1   | Grill      | `/risoluto-grill <slug>`                | idea README + evidence         | `## Why us / why now` + `## Smallest shippable shape`        | operator |
| 3.1.5 | Grill docs | `/grill-with-docs` (generic)            | the idea + existing canon      | updated `docs/*.md` and/or a new ADR (only if canon touched) | operator |
| 3.2   | To-PRD     | `/risoluto-to-prd <slug>`               | grilled idea README            | `docs/prds/<slug>.md`, Linear project, branch `pipeline/...` | operator |
| 3.3   | Drift gate | `pnpm prd:drift-check`                  | PRD body vs Linear             | (exit 1 on drift) — also runs in `.husky/pre-push`           | gate     |
| 4.1   | To-issues  | `/risoluto-to-issues <slug>`            | `docs/prds/<slug>.md`          | Linear issues labelled `from:prd-<slug>`                     | operator |
| 4.2   | TDD        | `/risoluto-tdd <ticket-ref>`            | Linear issue + linked PRD      | code + tests; PR; `from:prd-<slug>` label on the PR          | operator |
| 4.3   | Post-merge | CI (`.github/workflows/post-merge.yml`) | merged PR with the label       | flips PRD `status: shipped` + back-comments Linear           | CI       |
| 5.x   | Record     | ADR + `docs/decisions.md`               | the shipped decision           | an ADR entry + a decisions row                               | operator |

## Walkthrough

### 1. Capture research

```bash
/risoluto-vault                          # configure research/ as an Obsidian vault (idempotent)
/risoluto-researcher https://example.com # GitHub URLs get deep gh capture; INDEX.md is regenerated
pnpm validate:research                   # frontmatter must validate against research/.schemas/ (exit 0)
```

Tag sources with `ideas: [<idea-slug>]` in their frontmatter — that tag is what the synthesizer
clusters on.

### 2. Synthesize into idea clusters

```bash
/risoluto-synthesizer                    # full-corpus, idempotent
```

Groups every tagged target/source into `research/ideas/<slug>/README.md` and writes the
`status: idea` rows of `docs/capability-backlog.md` between its `BEGIN/END
risoluto-synthesizer:idea-rows` markers. It never clobbers operator prose or an operator-set
`ready`/`in-flight`/`shipped` status. Ideas whose evidence drops to zero are flipped to `dropped`
(not deleted) and revive on the next run if re-tagged.

### 3. Grill, optionally update docs, then promote to a PRD

```bash
/risoluto-grill <slug>                   # one question at a time; fills the two operator sections
```

On exit it writes `## Why us / why now` + `## Smallest shippable shape` and offers to flip the
backlog row `idea → ready`.

```bash
/grill-with-docs                         # ONLY if the idea touches existing docs/ADRs (operator judgement)
```

Run the generic `/grill-with-docs` between grill and to-prd **whenever the idea contradicts or
extends existing canon** (e.g. `docs/technical-spine.md`, or warrants a new ADR). It writes updated
`docs/*.md` / a new ADR — nothing to `research/` or Linear. Skip it for purely additive ideas.

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
pnpm prd:reconcile <slug>         # adopt the Linear edit into git (branch pipeline/<slug>-prd-reconcile)
/risoluto-to-prd <slug>           # or overwrite Linear from git (sync)
```

This also runs in `.husky/pre-push`. `LINEAR_API_KEY` is a **hard gate**: unset = exit 1 (it does
not silently pass). Do **not** edit Linear project descriptions in the UI — `prd:reconcile` exists
to _adopt_ an accidental UI edit, not as a sanctioned edit path.

### 4. Issues, implementation, post-merge

```bash
/risoluto-to-issues <slug>        # PRD → flat Linear issues labelled from:prd-<slug>, blocked-by inferred
/risoluto-tdd <ticket-ref>        # e.g. RSL-123: validates blocked-by are Done, runs red-green-refactor,
                                  # back-comments the PR, applies the from:prd-<slug> label, prints `gh pr create`
```

`to-issues` reads the full PRD body and uses an LLM pass to extract slices + dependencies; review
the proposed graph before issues are created. When a PR carrying the `from:prd-<slug>` label is
**merged**, `.github/workflows/post-merge.yml` runs `scripts/post-merge-prd.mjs`: it back-comments
the linked Linear issues with the PR, then flips the PRD frontmatter to `status: shipped` (the disk
write is the last step, after the Linear calls succeed). Requires the `LINEAR_API_KEY` repo secret.

### 5. Record the decision

Add an ADR under `docs/adr/` and a row to `docs/decisions.md` when a capability ships and the
decision is worth preserving. Section 7 of `docs/adr/0001-foundation.md` is the record for this pipeline itself.

## Frontmatter contract (the API of the pipeline)

The frontmatter in every research and PRD file is the joint between skills. JSON Schemas live under
`research/.schemas/` and are checked by `pnpm validate:research`.

| Schema file          | Validates frontmatter in                           |
| -------------------- | -------------------------------------------------- |
| `source.schema.json` | `research/targets/<slug>/sources/<source-slug>.md` |
| `target.schema.json` | `research/targets/<slug>/README.md`                |
| `idea.schema.json`   | `research/ideas/<slug>/README.md`                  |

```yaml
# sources/<source-slug>.md
target: <target-slug>
source_type: article|reddit|x|repo|video|paper|talk
url: https://...
captured_at: 2026-05-26
captured_by: risoluto-researcher|web-clipper|manual
ideas: [multi-agent-orchestration, cost-ceiling] # may be empty at capture

# targets/<slug>/README.md
slug: <target-slug>
canonical_url: https://...
category: peer|reference|adjacent
last_researched_at: 2026-05-26
ideas: [...] # union of sources/*.md ideas
source_count: <int>

# ideas/<slug>/README.md   (status lives in capability-backlog.md, never duplicated here)
slug: <idea-slug>
evidence_targets: [cursor, aider, ...]
evidence_sources: [targets/cursor/sources/multi-agent-thread.md, ...]
linear_project: https://linear.app/<workspace>/project/<slug>-<id> # set by to-prd; else null
prd_file: docs/prds/<slug>.md # set by to-prd; else null

# docs/prds/<slug>.md
slug: <slug>
linear_project: https://linear.app/<workspace>/project/<slug>-<id>
synced_at: 2026-05-26T...
source_idea: research/ideas/<slug>/README.md
status: draft|approved|shipped|archived
```

- **`additionalProperties: true` on every schema.** `research/` is also an Obsidian vault — Web
  Clipper / Templater / operator fields (`tags:`, `aliases:`, plugin keys) pass through untouched;
  schemas validate the pipeline-owned subset only.
- **Idempotent, no halt.** Re-running researcher/synthesizer against an existing slug repairs
  derived fields without clobbering operator prose — a second run is a repair run.
- **Slugs are namespaced by type:** `targets/<slug>/` and `ideas/<slug>/` may share a string.
- **Gap:** PRD frontmatter has no schema yet; `pnpm validate:research` does not validate
  `docs/prds/*.md`. A `prd.schema.json` + validator coverage is still to be added.

## Ownership: regenerated vs operator-owned

Synthesizer/skill-owned sections are **regenerated** on every run; operator-owned sections **evolve
forward** and are never clobbered (same pattern as `risoluto-features`).

| `research/ideas/<slug>/README.md` section                                          | Owner                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------- |
| `## Evidence`, `## Targets that ship this`, `## Variants observed`, `## Frequency` | synthesizer                            |
| `## Analyst notes`, `## Open questions`                                            | operator                               |
| `## Why us / why now`, `## Smallest shippable shape`                               | operator (filled by `/risoluto-grill`) |

For targets, the researcher owns `last_researched_*`, `ideas` (union), and `source_count`; the
operator owns `slug`, `canonical_url`, `category`. For backlog rows, the synthesizer owns `slug` and
`evidence_idea` and drafts `name`/`category` on first creation (sticky after); status `idea` is
synthesizer-set, `ready`/`in-flight`/`shipped` is operator-set, `dropped` is either.

## Invariants & gotchas

- **Slug is the join key.** Identical across idea/backlog/PRD/Linear/label. No ad-hoc variants.
- **Idempotent.** Researcher, synthesizer, vault, and to-prd sync are safe to re-run.
- **Git is canon for PRDs.** Resolve divergence with `prd:reconcile` (Linear → git) or `to-prd` sync
  (git → Linear). Never hand-edit Linear project descriptions.
- **No auto-PR.** Skills branch, commit, and push but never run `gh pr create` — they print it.
- **`LINEAR_API_KEY` required** for to-prd, drift-check, post-merge, and any `mcp__linear-server__*`
  call. Unset = hard gate (exit 1).
- **255-char Linear cap.** Drift detection only sees the first 255 chars of the PRD body; content
  past that is git-only and never drifts.
- **Operator banner.** After a CREATE-mode to-prd, paste the banner from `prds/README.md` into the
  new Linear project description.
- **Two separate vaults.** `research/` is its own Obsidian vault; `~/Documents/my-vault/` stays
  independent.

## Skills

Pipeline skills live in `skills/risoluto-*/` and are symlinked into `.claude/skills/` and
`.agents/skills/`: `risoluto-vault`, `risoluto-researcher`, `risoluto-synthesizer`,
`risoluto-grill`, `risoluto-to-prd`, `risoluto-to-issues`, `risoluto-tdd`.

**Fork-not-upgrade.** `to-prd`, `to-issues`, and `tdd` are Linear-specific forks of the global
`~/.claude/skills/{to-prd,to-issues,tdd}` — invoke the namespaced `/risoluto-*` variants in this
repo. The global skills stay tracker-agnostic. `grill-me`, `grill-with-docs`, and `save-to-obsidian`
are used as-is (generic).

## Not in scope

- **Bidirectional Linear ↔ git sync.** Only git → Linear (on to-prd/to-issues create) and PR →
  Linear back-comment ship. Linear issue-state/comment/label edits back to git are deferred; the PRD
  drift hook is the only Linear-watching surface.
- **No GitHub Issues mirror.** Public exposure is deferred; Linear is the sole planning surface.
- **Runtime auto-pickup.** Auto-consuming Linear tickets is a separate workstream parked behind the
  `auto:runtime` label seam; this pipeline stops at manual `/risoluto-tdd <ticket-ref>`.

## Decided enhancements (pending implementation)

Eight decisions from a `/grill-with-docs` pass (provenance: 2026-05-29). All are **decided** and
specced here; none are built yet. They refine decision #29 / ADR §7 — they do not change the
foundation, so no new ADR (H5 is the one row worth adding to `decisions.md`).

**The finding that triggered them:** the live corpus is **3 single-source targets → 27 ideas**, of
which only `provider-abstraction` clears ≥2 evidence targets. The synthesizer's clustering and the
grill's "N peers do X" framing assume N>1 — false for 26/27 ideas today. The pipeline is being used
for single-repo feature extraction, not cross-target pattern detection. Several decisions below close
the gap between what the pipeline _claims_ and what a thin corpus _supports_.

| #   | Decision                                                                                                                                                                        | Why                                                                                                  | Lands in                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| H1  | **Evidence floor ≥2.** Block (or hard-warn) `idea → ready` until an idea has ≥2 evidence targets. Treat today's 3-repo corpus as feature extraction; widen capture before re-synthesizing. | Makes Frequency / Variants observed / "N peers" true instead of decorative.                          | `risoluto-synthesizer` (warn), `risoluto-grill` (gate), §2–§3                                  |
| H2  | **Full-body drift hash.** Stamp `synced_hash` (hash of the whole PRD body) into PRD frontmatter on every `to-prd` sync; `prd:drift-check` compares the hash. The 255-char Linear text stays the human mirror. | Drift is detected on the first 255 chars (~7%) only; the rest can diverge silently.                  | `scripts/prd-drift-check.ts`, `scripts/prd-linear.ts`, frontmatter contract, §3.3              |
| H3  | **Scope the pre-push gate.** Run `prd:drift-check` in `.husky/pre-push` only when the push range touches `docs/prds/*`; otherwise no-op (no `LINEAR_API_KEY` needed).          | A public repo's contributors, CI, fresh clones, and runtime push-agents shouldn't need a Linear token to push non-PRD changes. | `.husky/pre-push`, §3.3, Invariants                                                            |
| H4  | **Idempotent `to-issues`.** Key created issues by a stable per-slice id (`from:prd-<slug>` + slice slug); re-runs add new slices, skip existing, report removed.              | PRDs grow after issues exist; re-running must reconcile, not duplicate — matches the rest of the pipeline. | `risoluto-to-issues`, Invariants (add to-issues to the idempotent list)                        |
| H5  | **Pipeline is the first Workflow Definition target.** Designate the implement-leg (`to-issues → tdd → post-merge`) as the first built-in TS Workflow Definition (ADR §5). Add a `pipeline-as-workflow-definition` backlog idea. | Closes §5's "zero definitions" gap and gives §1's run-vs-issue reconciliation a concrete consumer — running the pipeline and dogfooding the runtime become one effort. | `decisions.md` row, ADR §5/§7 follow-up, backlog idea, Mental model                            |
| H6  | **Post-merge closes the backlog row.** Extend `scripts/post-merge-prd.mjs` to flip the matching `capability-backlog.md` row to `shipped` (it has the slug from the label), alongside the PRD flip + Linear back-comment. | The backlog is the canonical discovery surface; it must not read `in-flight` while the PRD says `shipped`. | `scripts/post-merge-prd.mjs`, §4.3 / §5                                                        |
| H7  | **Teardown path for dropped ideas.** Dropping an idea that has `linear_project` set flips the PRD to `archived` and **prints** the Linear-project-archive + branch-delete commands (no auto-destruction). | `dropped` must mean something end-to-end, else Linear projects + `pipeline/<slug>-prd` branches orphan with no backreference. | `risoluto-synthesizer` / operator step, §3, Invariants                                         |
| H8  | **Cross-file slug check.** Extend `validate:research` (and add the missing `prd.schema.json`) to assert `idea.slug == backlog slug == prd.slug == prd filename == Linear label suffix`; fail loudly on mismatch. | "One slug is the join key" is load-bearing but unenforced — one typo silently breaks post-merge label match, drift pairing, and issue linkage. | `scripts/validate-research.ts`, `research/.schemas/prd.schema.json`, frontmatter contract      |

H8 also resolves the existing **Gap** noted under the frontmatter contract (no `prd.schema.json`,
`validate:research` skips `docs/prds/*`). H4 adds `to-issues` to the idempotent invariant. H5 is the
only item that warrants a `decisions.md` entry (a refinement row under #29).

## Reference

**Scripts:** `scripts/validate-research.ts` (`pnpm validate:research`),
`scripts/prd-drift-check.ts` (`pnpm prd:drift-check`), `scripts/prd-reconcile.ts`
(`pnpm prd:reconcile`), `scripts/prd-linear.ts` (Linear GraphQL helpers),
`scripts/post-merge-prd.mjs` (CI post-merge automation).

**Key files:** `research/targets/`, `research/ideas/`, `research/INDEX.md`,
`docs/capability-backlog.md`, `docs/prds/`, `docs/adr/0001-foundation.md` (§7).

## Troubleshooting

| Symptom                                      | Cause / fix                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Any skill or `validate:research` fails early | `research/` submodule not initialized — `git submodule update --init research`.     |
| `prd:drift-check` exits 1 "hard gate"        | `LINEAR_API_KEY` is unset — export it (or set the GH secret for CI).                |
| `prd:drift-check` reports DRIFT              | PRD body and Linear diverged — `prd:reconcile <slug>` or `to-prd <slug>` to sync.   |
| `pre-push` blocked                           | A PRD drifted — resolve drift, or fix the failing gate step it reports.             |
| Post-merge didn't flip status                | PR lacked the `from:prd-<slug>` label, or the Linear call failed (flip is skipped). |
