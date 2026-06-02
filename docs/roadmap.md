# Roadmap

> The **single ordered plan** for Risoluto. One hand-owned file, top-to-bottom by priority: the top
> row is literally "what's next." This replaces the old scattered backlog + idea folders — there is
> no other plan surface in git. If work isn't here, it isn't planned.

## How it works

- **Order is priority.** Rows are kept sorted; the highest row that isn't `shipped` is the next thing to pick up.
- **Nothing is `next` without a Why and a Size.** An item stays `idea` until it has a reason to do it now and a rough size. This is the gate that stops scatter from creeping back.
- **The founder owns ranking, promotion, and kills.** Skills (the researcher-fed critic-grill in Mode A and the ingest idea-engine in Mode B) may APPEND proposed `idea` rows — the founder dispositions each one. No skill reorders, promotes, or deletes rows.
- **It graduates, it doesn't sprawl.** When an item reaches `next`, it leaves the roadmap _as a row_ and enters the [research → shipping pipeline](./research-to-shipping-pipeline.md): PRD → Linear issues → TDD → merge. The row's status tracks that journey; the detail lives in the PRD and Linear.
- **Pruning is a move too.** The roadmap gates what comes _in_ and what goes _out_. A `deprecated` row marks shipped surface slated for removal when it is unused or no longer worth its complexity cost — the [exit gate](./research-to-shipping-pipeline.md#exit-gate-pruning-shipped-surface). For a tool whose dominant failure mode is complexity, removing surface is as load-bearing as adding it.

## Status vocabulary

| Status         | Meaning                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **idea**       | Named. Needs a Why + Size before it can be picked up.                                                                                                                                                       |
| **next**       | Scoped (has Why + Size) and ranked to start soon. Has or is about to get a PRD.                                                                                                                             |
| **building**   | A PRD exists and Linear issues are in flight (`from:prd-<slug>`). The Status cell may link the Linear project.                                                                                              |
| **shipped**    | Merged in the canonical repo. Recorded in [decisions.md](./decisions.md) if notable.                                                                                                                        |
| **dropped**    | Killed. The reason is written in the **Why now** cell — never silently removed.                                                                                                                             |
| **superseded** | Replaced by a newer row or shipped feature. The superseding row/feature is named in the Why now cell.                                                                                                       |
| **deprecated** | Shipped, now marked for removal — unused or no longer worth its complexity / maintenance cost. The exit gate; see the [pipeline doc](./research-to-shipping-pipeline.md#exit-gate-pruning-shipped-surface). |

## The plan

> Newest decisions sit where their priority puts them, not at the bottom. Keep it short — a roadmap
> with 40 rows is a backlog wearing a costume.

| #   | Item                                                        | Why now                                                                                                                                                                                                                                                                                                                                | Size | Status                                                                              | Research link |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- | ------------- |
| 1   | Workflow-first AFK MVP <!-- slug:workflow-first-afk-mvp --> | Proves Risoluto's core thesis: configurable Workflow Runs execute AFK engineering work end to end across CLI, Slack, HTTP, tracker intake, worktrees, PR/CI, verifier, evidence, memory, and handoff without making Linear/GitHub issue identity primary.                                                                              | L    | [building](https://linear.app/ninetech/project/workflow-first-afk-mvp-838087658d56) | —             |
| 2   | Verification ladder <!-- slug:verification-ladder -->       | The green gate proves units work, not that capabilities are reachable from a real intake — workflow-first-afk-mvp shipped features "done" yet wired only in tests, forcing a costly after-the-fact rework pass. A static reachability gate + e2e intake tier + in-loop pipeline enforcement makes "done" mean shipped, not just green. | M    | [building](https://linear.app/ninetech/project/verification-ladder-f60d2c7e97f2)    | —             |
|     |                                                             |                                                                                                                                                                                                                                                                                                                                        |      |                                                                                     |               |

<!--
  Add rows above. Size = S / M / L (rough effort).
  Research link = path to research/targets/<slug>/README.md or research/wiki/<note>.md that motivated the row (em-dash for pure-judgment rows).
  A row that has entered the pipeline carries its slug as a trailing HTML comment in the Item cell: Title <!-- slug:<slug> -\->
  The slug is the join key: roadmap row ↔ PRD filename ↔ prd.slug frontmatter ↔ Linear from:prd-<slug> label.
-->

## How an item moves

```
[Mode A] /risoluto-researcher ──▶ dedup ──▶ /risoluto-grill (critic) ──┐
                                                                        │  founder dispositions (in/out/rank)
[Mode B] /risoluto-ingest (wiki + gap-grounded ideas) ─────────────────┘
                                                                        │
                                                          append idea row to roadmap
                                                                        │
                                                                        ▼
idea ──(founder writes Why + Size, ranks it)──▶ next ──/risoluto-to-prd──▶ building ──merge + post-merge──▶ shipped
   │
   └────────────────────(founder kills it; reason goes in Why now cell)──────────────────────────────────▶ dropped
```

Research feeds the roadmap through **two structured modes**, not hand-folding alone:

- **Mode A (targeted adoption):** `/risoluto-researcher` deep-analyzes one source, deduplicates candidates against shipped features and existing rows (skip / merge / supersede / new), and passes survivors to `/risoluto-grill` (the critic). The founder decides in/out per candidate; kept ones become `idea` rows whose Research link points to `research/targets/<slug>/README.md`.
- **Mode B (sense-making / innovation):** `/risoluto-ingest` reads all `research/targets/` and builds a connected wiki at `research/wiki/`. It then emits gap-grounded ideas — each citing the dots it connects — as `idea` rows whose Research link points to the relevant wiki note or target README.

In both modes, **skills propose; the founder disposes.** The roadmap — not the research vault — is the source of "what's next." Dedup semantics: a `superseded` row is marked when a researcher candidate obsoletes it; `merge` folds a takeaway into an existing row without adding a new one; `skip` drops a candidate already shipped or already covered by an open row.

## Relation to Linear

[Linear is canonical for implementation planning](./decisions.md) (projects + flat issues with
blocked-by). The roadmap is the **upstream, git-diffable, single-file** view of intent; a row becomes
a Linear Project + issues only when it reaches `building` via the pipeline. Git stays canonical for
PRDs; Linear mirrors them.

## Related docs

- [Research → Shipping Pipeline](./research-to-shipping-pipeline.md) — how a `next` row becomes merged code.
- [Product Spine](./product-spine.md) — what Risoluto is; its "does not implement" list is the boundary on what belongs here.
- [Decisions](./decisions.md) — where shipped, notable decisions are recorded.
