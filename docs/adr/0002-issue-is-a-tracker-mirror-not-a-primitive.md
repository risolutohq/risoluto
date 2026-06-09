---
status: accepted
---

# Issue is a Tracker Mirror, not a primitive

The core primitive is the **Workflow Run**, identified by its own `wr_*` id. **`Issue` is the Tracker
Mirror** — the adapter-sourced projection of an external tracker item — not a peer entity and not a run
key. `issueId` / `issueIdentifier` legitimately name **Tracker Issue coordinates** (the adapter's opaque
UUID and the human slug, e.g. `ENG-123`); they are distinct from the Workflow Run id, never an alias for it.

The codebase reached this decision mid-migration: a 2026-06-03 terminology audit (30 agents, 154 drift
candidates, 18 adversarially verified) found two coexisting vocabularies — a spine-aligned `WorkflowRun`
generation layered over a legacy `Issue`-keyed generation. The execution layer still keys on tracker
identity as the run's primary key (`AttemptRecord.issueId`, the `attempts` / `issue_index` /
`pull_requests` SQLite tables, the `issue.*` event channels, the `/api/v1/:issue_identifier/*` routes), and
the `attempts` table has **no `workflow_run_id` column**. That missing column — not the field names — is
the tracked gap.

## Considered options

- **Mass-rename every `issueId` → `workflowRunId`** — rejected. It conflates two genuinely distinct ids and
  destroys the Tracker Issue coordinate semantics the adapter boundary depends on.
- **Keep tracker-keying as the run's identity** — rejected. It keeps `Issue` alive as a first-class
  primitive, contradicting the spine's first principle ("Workflow Run is the core primitive, not Issue").
- **Keep tracker coordinates named as such; add `workflowRunId` as the canonical execution key** — chosen.
  Add a `workflow_run_id` column, make it the join key, and migrate keying run-by-run, while
  `issueId`/`issueIdentifier` stay as the Tracker Mirror's own coordinates.

## Consequences

- [`CONTEXT.md`](../../CONTEXT.md) disambiguates **Tracker Issue** vs **Workflow Run** vs **Tracker
  Mirror** so future code does not reintroduce the conflation.
- Remediation is tiered by blast radius: safe internal renames and structural fixes first; the persisted
  columns, HTTP routes, and `issue.*` event channels are a gated public-surface migration that needs its
  own PRD (data migration + API version bump). **Progress:** the `issue.*` event channels are now
  `@deprecated` in favour of shipped `workflow_run.*` channels (`src/core/risoluto-events.ts`), and
  run-keyed `/api/v1/workflow-runs/*` routes have landed (`src/http/routes/workflow-runs.ts`) beside the
  legacy `:issue_identifier` routes; the `attempts` table's missing `workflow_run_id` column remains the core gap.
- Until that migration lands, `issueId` as a de-facto run key is a known, documented gap — not evidence
  that `Issue` is a primitive.
