# ADR-0001: Workflow Run as Core Primitive

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

The legacy Risoluto implementation treated **Issue** (specifically a Linear issue) as the core domain object. Worker lifecycle, attempt storage, dispatch, and persistence were all keyed on issue identity. This made:

- Adding a second tracker (GitHub Issues, GitLab, Jira) a translation problem instead of an adapter problem.
- Adding non-tracker intake (CLI command, schedule, PRD slice, webhook from a non-tracker source) awkward — there was no neutral primitive to attach the work to.
- Multi-attempt semantics inconsistent — attempts hung off the issue rather than off a durable execution record.
- The system's identity drift toward "Linear automation" instead of "engineering work orchestration."

## Decision

The core primitive is **Workflow Run** — a durable, retryable, replayable execution instance of a **Workflow Definition** triggered by an **Engineering Intent**. Trackers are intake / mirror / projection **adapters** that attach to or update existing Workflow Runs; they do not own the work.

Concretely:

- All persistence, dispatch, scheduling, and observability key off Workflow Run identity.
- Tracker items (issues, MRs, etc.) map to Workflow Runs via a mapping table, not via primary-key identity.
- A Workflow Run can have multiple **Run Attempts** (for retry / fanout / resume).
- Workflow Definitions are reusable templates expressed as state machines (see [ADR-0002](./0002-state-machine-with-graph-inside-states.md)).

## Consequences

**Positive.**

- Tracker pluralism is an adapter problem (good) rather than a core refactor (bad).
- Non-tracker intake (CLI, schedule, PRD slice) is first-class without special-casing.
- Multi-attempt semantics are uniform and live where they belong — on the run record.
- Observability, replay, and export have one consistent shape.

**Negative.**

- The legacy issue-keyed code does not survive the curated snapshot import as-is. Persistence, dispatch, and attempt storage are all rebuilt against Workflow Run.
- Operator-facing language has to be re-taught — "issue" stops being the unit of work in internal terminology.
- Tracker-mirroring is a write-back surface from the start; the adapter must keep tracker state coherent with workflow state.

**Neutral.**

- Operator-facing surfaces (CLI / TUI / tracker UI) can still **show** issues. The change is internal naming and identity, not external presentation.

## Alternatives Considered

- **Keep Issue as primitive, add a "WorkflowAttempt" sub-concept.** Rejected: leaves the system identity Linear-shaped and bakes "tracker == truth" into every layer.
- **Generic "Job" primitive.** Rejected: too thin. The workflow / state / role / artifact vocabulary is what makes Risoluto useful; "Job" hides it.
- **Two parallel primitives (Issue and WorkflowRun) during transition.** Rejected: doubles the data model, doubles the test matrix, and reliably means one of the two atrophies and the wrong one wins.
