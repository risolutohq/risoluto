# Roadmap

> The **single ordered plan** for Risoluto. One hand-owned file, top-to-bottom by priority: the top
> row is literally "what's next." This replaces the old scattered backlog + idea folders — there is
> no other plan surface in git. If work isn't here, it isn't planned.

## How it works

- **Order is priority.** Rows are kept sorted; the highest row that isn't `shipped` is the next thing to pick up.
- **Nothing is `next` without a Why and a Size.** An item stays `idea` until it has a reason to do it now and a rough size. This is the gate that stops scatter from creeping back.
- **One owner: the operator.** No tool regenerates this file. Items are added, ranked, and retired by hand (optionally informed by research — see below).
- **It graduates, it doesn't sprawl.** When an item reaches `next`, it leaves the roadmap _as a row_ and enters the [research → shipping pipeline](./research-to-shipping-pipeline.md): PRD → Linear issues → TDD → merge. The row's status tracks that journey; the detail lives in the PRD and Linear.

## Status vocabulary

| Status       | Meaning                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| **idea**     | Named. Needs a Why + Size before it can be picked up.                                |
| **next**     | Scoped (has Why + Size) and ranked to start soon. Has or is about to get a PRD.      |
| **building** | A PRD exists and Linear issues are in flight (`from:prd-<slug>`).                    |
| **shipped**  | Merged in the canonical repo. Recorded in [decisions.md](./decisions.md) if notable. |
| **dropped**  | Killed. The reason is written in the Notes cell — never silently removed.            |

## The plan

> Newest decisions sit where their priority puts them, not at the bottom. Keep it short — a roadmap
> with 40 rows is a backlog wearing a costume.

| #   | Item | Why now | Size | Status | Link |
| --- | ---- | ------- | ---- | ------ | ---- |
|     |      |         |      |        |      |

<!-- Add rows above. Size = S / M / L (rough effort). Link = PRD path or Linear project once it exists. -->

## How an item moves

```
idea ──(write Why + Size, rank it)──▶ next ──/risoluto-to-prd──▶ building ──merge + post-merge──▶ shipped
   │
   └────────────────────────────(operator kills it, with a reason)──────────────────────────▶ dropped
```

Research is an **optional input**, not a parallel plan: when you want to study peers or a problem
space, capture it with `/risoluto-researcher`, then fold whatever matters into a roadmap row
yourself. The roadmap — not the research vault — is the source of "what's next."

## Relation to Linear

[Linear is canonical for implementation planning](./decisions.md) (projects + flat issues with
blocked-by). The roadmap is the **upstream, git-diffable, single-file** view of intent; a row becomes
a Linear Project + issues only when it reaches `building` via the pipeline. Git stays canonical for
PRDs; Linear mirrors them.

## Related docs

- [Research → Shipping Pipeline](./research-to-shipping-pipeline.md) — how a `next` row becomes merged code.
- [Product Spine](./product-spine.md) — what Risoluto is; its "does not implement" list is the boundary on what belongs here.
- [Decisions](./decisions.md) — where shipped, notable decisions are recorded.
