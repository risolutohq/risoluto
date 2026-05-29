---
name: risoluto-next-bundle
description: >
  Scan open Linear issues across all PRDs (the from:prd-<slug> labels), filter to
  the ready-set (no open blocked-by), predict code-locality, and propose 1–3
  mutually conflict-free bundles — each meant to run as one parallel git worktree
  without colliding with the others — plus a one-line goal per bundle. Use whenever
  Omer says /risoluto-next-bundle, "bundle the next work", "group issues by code
  locality", "what should we build together next", "what can I run in parallel",
  "which issues are safe to run in separate worktrees", "propose a sprint bundle",
  or any phrasing that implies grouping open Linear issues into parallel-safe units
  of work.
---

# risoluto-next-bundle

Build-sequencing helper for **parallel worktrees**. Reads open Linear issues from every known
`from:prd-<slug>` label, filters to the ready-set (issues whose `blocked-by` are all `Done`),
groups them by predicted code-locality, and proposes 1–3 bundles that are **mutually conflict-free**
— each meant to run as one git worktree without colliding with the others. The founder picks which
bundles to launch; the skill only proposes — it creates nothing in Linear.

This is an **initial minimal version** (heuristic grouping; the agent does the locality
reasoning against its knowledge of the codebase). The grouping heuristic will sharpen as more
PRDs and issues accumulate.

## Two constraints, neither of which is the roadmap

Running multiple worktrees in parallel faces two independent constraints — and the roadmap owns
neither:

1. **Ordering correctness** — an issue may not start before its blockers merge. This lives in
   Linear's `blocked-by` graph, at issue granularity. This skill reads it as the **ready-set**
   filter: an issue is eligible only when all its `blocked-by` are `Done`.
2. **Concurrency safety** — two agents must never edit overlapping file regions, or they collide at
   merge. This is what code-locality prediction is for. This skill treats predicted locality as a
   **lock**: bundles it proposes must hold _disjoint_ regions, so two worktrees never contend.

The roadmap (`docs/roadmap.md`) stays a coarse, founder-owned **intent** ledger — one flat ordered
list, order = priority, no dependency edges. A dependency DAG on the roadmap would duplicate the
`blocked-by` graph Linear already owns and add a second sync burden on top of git↔Linear. So this
skill is the **scheduler seam**: it reads Linear's ordering graph and the locality lock and emits a
parallel-safe work plan. The roadmap is never touched.

Decision reference: decision #31 in `docs/decisions.md` (next-bundle build-sequencing capability).
Pipeline reference: `docs/research-to-shipping-pipeline.md` — the back-half sequencing concern:
after the roadmap has several `next` rows each with open Linear issues, this skill answers
"which issues should ship together?".

## What this skill produces

A **proposed bundle list** shown in conversation — not written to any file, not sent to Linear:

```
Bundle 1 — <one-line goal>
  Issues: <issue-id> "<title>", <issue-id> "<title>", ...
  Why together: <shared module or file path>

Bundle 2 — ...
```

The founder picks a bundle. The skill stops there — no issue updates, no Linear edits.

## Hard preconditions

Stop and report if any fail:

| Check                       | Command                                        | If it fails                                                                       |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Run from repo root          | `test -f package.json && test -f .gitmodules`  | Tell Omer to `cd` into the `risoluto` checkout root.                              |
| `docs/prds/` exists         | `test -d docs/prds`                            | No PRDs yet — run `/risoluto-to-prd` on a `next` roadmap row first.               |
| At least one non-README PRD | `ls docs/prds/*.md` (excluding README.md)      | No PRDs to pull issues for — nothing to bundle. Tell Omer to promote a row first. |
| Linear MCP responding       | Any `mcp__linear-server__list_issues` succeeds | Surface the MCP error verbatim; do not retry auth.                                |

## Pipeline

Two steps: **preload**, then **agent-driven grouping**.

### Step 1 — Preload

```bash
node skills/risoluto-next-bundle/scripts/preload.mjs
```

Stdout: JSON `{ prds: [{ slug, status, linear_project, label, roadmap_item }] }`.
Stderr: one-line summary (PRD count, statuses).

Show Omer the summary line; do not dump the JSON unless asked.

### Step 2 — Agent-driven grouping (Linear MCP + locality reasoning)

For each PRD entry from preload:

1. Query open issues with that PRD's label via `mcp__linear-server__list_issues` (filter by `label: "from:prd-<slug>"`).
2. Collect all open issues across all PRDs into a flat list with their title and label.
3. Group by predicted code-locality:
   - **Same PRD** = obvious candidate for a bundle (they share the PRD's module surface).
   - **Cross-PRD** = bundle when two PRDs' issue titles reference the same Risoluto module
     (e.g. both mention `WorkflowRun`, `StorageAdapter`, `CLI`, `EventWriter`).
   - Singleton issues with no obvious neighbour = a bundle of one if they are `next`-status PRDs,
     otherwise hold.
4. Propose 1–3 bundles. Each bundle has:
   - A one-line goal (imperative sentence, ≤12 words).
   - The list of issue IDs + titles.
   - A one-sentence "why together" (shared module or file surface, or shared PRD).
5. Present bundles to Omer in conversation. He picks one or asks for a reshuffle.

**The skill stops here.** It does not update any issues, create any Linear objects, or write
any files. If Omer picks a bundle, he uses it as input to `/risoluto-tdd` or his own sprint
planning — the skill's job is to surface the grouping, not to act on it.

## Notes for the agent

- **No issue mutations.** The skill is strictly read-only with respect to Linear.
- **Locality is heuristic.** The agent reasons from issue titles and PRD surface area — it
  does not have access to a dependency graph. Flag uncertainty when two issues could plausibly
  go in either bundle.
- **Prefer fewer, larger bundles** over many micro-bundles. 1–3 bundles is the target range.
  If there are fewer than three open issues total, one bundle is fine.
- **Only include open issues.** Skip completed, cancelled, or in-progress issues unless Omer
  asks otherwise.
- **Linear MCP errors are operator concerns.** Surface verbatim, do not retry.
- **The roadmap_item field** in preload output annotates each slug with its roadmap row title —
  use it in the bundle goal text so Omer can orient without opening Linear.

## Companion files

- `docs/research-to-shipping-pipeline.md` — full pipeline; this skill addresses the
  back-half sequencing concern (multiple `next` rows, choose what ships together).
- `docs/decisions.md` #31 — the decision that introduced this skill.
- `skills/risoluto-to-issues/` — the skill that created the `from:prd-<slug>` issues this
  skill reads.
- `skills/risoluto-tdd/` — the skill the founder runs after picking a bundle.
