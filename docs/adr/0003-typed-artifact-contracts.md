# ADR-0003: Typed Artifact Contracts Between Role Executions

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Agent Roles inside a Workflow Run hand work to each other — planner → implementer, implementer → reviewer, reviewer → release operator. If that handoff is freeform text, every downstream role becomes a fragile prompt-engineering exercise interpreting the previous role's output. Tests across roles become brittle. Replay loses meaning. Memory Builder cannot reliably extract lessons.

## Decision

Every artifact a Role Execution produces or consumes is bound to a **typed Artifact Contract** — a schema (TypeScript type + runtime validator) plus a meaning description.

- Contracts are versioned.
- A role declares the Artifact Contracts it consumes (inputs) and produces (outputs).
- The Role Execution runtime validates artifacts against their contract **at production time, not at consumption time**, so failures are attributed to the producer.
- Raw harness-native evidence (e.g., Codex JSONL) is stored alongside but separately from contract-bound artifacts.

## Consequences

**Positive.** Cross-role testing is real — synthesize a valid input artifact, run the role, validate the output. Memory Builder has structured surfaces to extract from. Replay is meaningful. Plugin authors have a real interface.

**Negative.** Contract drift becomes a thing to manage (versioning, migration). More upfront design per role.

**Neutral.** A role can still emit raw evidence as a side-channel; the contract governs the consumed surface.

## Alternatives Considered

- **Freeform text handoff.** Rejected: fragility scales worse-than-linearly with role count.
- **JSON-without-schema.** Rejected: looks structured, behaves freeform.
- **Contracts only at workflow boundaries.** Rejected: hides intra-state coupling; defeats the point.
