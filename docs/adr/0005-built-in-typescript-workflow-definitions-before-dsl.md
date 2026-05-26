# ADR-0005: Built-In TypeScript Workflow Definitions Before User-Authored DSL

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Risoluto's value depends on Workflow Definitions — the planner → implementer → reviewer → release-operator pipeline, the fanout-and-grade pipeline, the spec-first interviewer pipeline. Operators will eventually want to author their own. A user-facing DSL is the natural shape.

Designing a DSL before the first three built-in definitions exist is premature: the DSL would encode guesses about which primitives matter, which Artifact Contracts repeat, and which hook patterns are universal.

## Decision

v1 ships **built-in TypeScript Workflow Definitions** as typed records (state machine + role DAG + artifact contracts) in the main repo. **No user-authored workflow DSL in v1.**

- Built-in definitions are versioned product artifacts (treated like skill packs).
- Operators select / configure them by name; tuning happens via parameters, not authoring.
- The DSL is a deferred decision ([decisions.md #27](../decisions.md)). Trigger: after at least three built-in definitions ship and authoring pain is observed.

## Consequences

**Positive.** v1 ships with concrete, tested, dogfooded workflow shapes. The DSL — when it lands — encodes real patterns instead of imagined ones. Faster to v1.

**Negative.** Operators who want custom workflows in v1 fork built-ins as TypeScript code, which is a higher bar than DSL authoring.

**Neutral.** Built-in definitions become the reference implementations for the eventual DSL semantics.

## Alternatives Considered

- **Ship the DSL in v1.** Rejected: premature; encodes guesses.
- **No built-in definitions; operators always write code.** Rejected: defeats the product.
- **YAML / JSON descriptor format as a half-step.** Rejected: behaves like a DSL without the type system; worst of both.
