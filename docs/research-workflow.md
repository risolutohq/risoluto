# Research Workflow

> How research, operator decisions, and tracker work flow into Risoluto's canonical planning surface (Linear) and its public mirror (GitHub Issues).

## Surfaces

| Surface | Role |
|---|---|
| **Linear** | Canonical planning. All accepted work lands here first. |
| **GitHub Issues** (`risolutohq/risoluto`) | **Public intake / mirror.** Selective public exposure of accepted work; not the planning source. |
| **`research/` submodule** (private) | Per-target peer / competitor / reference ledgers. Operator intel. |
| **`docs/`** (this repo) | Current-truth product / technical / decision docs. |
| **Operator's wiki / Obsidian vault** | Long-tail thinking; opt-in retrieval via future skills. |

## Flow

```
$grill-me
   └─→ ordered transition artifact (in /docs or operator-local)
        └─→ $grill-with-docs
             └─→ doc updates (this repo) + sharpened decisions
                  └─→ $to-prd
                       └─→ canonical PRD published to Linear
                            └─→ $to-issues
                                 └─→ Linear implementation slices created
                                      └─→ selected public slices mirrored to GitHub Issues
                                           └─→ PRs link back to Linear + GitHub mirror
```

## Roles

- **Operator.** Owns the queue, decides what enters Linear, decides what mirrors publicly.
- **Skills.** Tooling for the steps above. `$grill-me`, `$grill-with-docs`, `$to-prd`, `$to-issues` are explicit invocations, not auto-triggers.
- **Risoluto runtime.** Consumes Linear tickets as Engineering Intents; produces PRs back into canonical / mirror repos.

## What This Workflow Is *Not*

- A ticket-management substitute for Linear. Tickets live in Linear.
- A backlog database. The backlog lives in [capability-backlog.md](./capability-backlog.md) as a summary; tickets are the detail.
- A research corpus. Research lives in the private `research/` submodule.

## Cadence

- New research target: explicit `$risoluto-researcher` invocation per target; output lands in `research/`.
- New decision: capture in [decisions.md](./decisions.md); promote to an ADR if hard-to-reverse.
- New capability: capture in [capability-backlog.md](./capability-backlog.md); promote to Linear when ready.

## Future Skills

- `risoluto-synthesizer` — turn research corpus into capability-backlog candidate entries grouped by user-story arc. Deferred until the corpus exceeds ~20 targets.
