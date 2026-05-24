# ADR-0002: State Machine with Graph Execution Inside States

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

A Workflow Definition needs to express both **outer lifecycle progression** (`classify` → `plan` → `implement` → `review` → `validate` → `publish` → `done`) and **intra-state structure** (within `implement`, the planner role produces an artifact the implementer consumes, the implementer produces an artifact the tester consumes, etc.).

Pure state machines are too coarse — they can model the outer progression cleanly but force role-to-role flow into hidden state-explosion. Pure DAGs are too soupy — they lose the discrete lifecycle that makes gates, transitions, and external tracker projection meaningful.

## Decision

A Workflow Definition is a **state machine of named Workflow States**. Inside each state, **Role Execution is a typed DAG** of Agent Roles connected by Artifact Contracts.

- Outer transitions between states are gated by **Validation Gates** and triggered by **Transitions**.
- Inside a state, roles produce / consume artifacts according to typed contracts; the DAG shape is part of the state definition.
- Hooks fire at state entry / exit and at named DAG nodes.

## Consequences

**Positive.** Outer lifecycle is legible to operators, tracker projections, and gates. Inner role choreography is expressive without leaking into the state vocabulary.

**Negative.** Two structural models to keep coherent. Authoring a Workflow Definition requires understanding both layers.

**Neutral.** Built-in TypeScript Workflow Definitions encode both layers as typed records (see [ADR-0005](./0005-built-in-typescript-workflow-definitions-before-dsl.md)); a future DSL would surface them ergonomically.

## Alternatives Considered

- **Pure state machine (no intra-state DAG).** Rejected: forces role choreography into flat sequential roles or state explosion.
- **Pure DAG (no outer state machine).** Rejected: loses operator-legible lifecycle and makes gates / tracker projection harder.
- **Hierarchical state machine (states-within-states).** Rejected: solves recursion but not parallel role execution.
