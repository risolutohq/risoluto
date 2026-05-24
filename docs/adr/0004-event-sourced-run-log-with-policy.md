# ADR-0004: Event-Sourced Run Log with Retention / Redaction / Export Policy

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

A Workflow Run accumulates: state transitions, role executions, artifact creations, hook firings, gate evaluations, retries, errors, harness output, model calls. The system needs to support replay (re-execute a run from a checkpoint), audit (who / what happened), export (hand a run to another environment), and redaction (strip secret / PII material before export).

Mutable state (current snapshot only) cannot serve replay or audit. Append-only event sourcing does — provided the same log is the source of truth for live state, not a parallel write.

## Decision

Workflow Run state is derived from an **event-sourced Run Log**. The Run Log is append-only; live state (`current state`, `current attempt`, etc.) is a projection of the log, not a separate write.

- Each event has a typed payload and a monotonic sequence.
- Retention policy is per-Workflow-Definition (with environment overrides).
- Redaction policy strips fields by classification (secret / PII / cost / freeform) before export.
- Export emits a self-contained replayable bundle (events + referenced artifacts).

## Consequences

**Positive.** Replay, audit, export, and Memory Builder all consume the same surface. No "live state vs log" divergence bug class. Run handoff between environments is well-defined.

**Negative.** Schema migration of historical events is real work. Storage cost grows with event volume — retention policy is mandatory, not optional.

**Neutral.** Live state projection performance is a separate optimization (cache / snapshot) but does not change the source of truth.

## Alternatives Considered

- **Mutable state record with a parallel audit log.** Rejected: double-write divergence is inevitable.
- **CRDT-based run state.** Rejected: complexity unjustified for a single-writer-per-run workload.
- **File-based JSONL log only (no DB projection).** Rejected: live operator surfaces (CLI / TUI / HTTP) need indexed reads.
