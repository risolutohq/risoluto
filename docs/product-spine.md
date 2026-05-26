# Risoluto — Product Spine

> **Identity.** Risoluto is **workflow-run-centered background agent orchestration for engineering work.** Engineering intent — issues, PRDs, schedules, operator commands — becomes durable Workflow Runs executed by reusable Agent Roles across pluggable trackers, harnesses, and model providers.
>
> The single-operator overnight-solo pipeline (the "personal autonomous coder" use case) is the first reference Workflow Definition Risoluto ships, not the identity. Other Workflow Definitions will follow on the same primitives.

---

## What Risoluto Is

A workflow-run engine for autonomous engineering work, with:

- A **Workflow Run** as the durable, retryable, replayable execution primitive.
- **Workflow Definitions** that express how engineering work flows through named states (`classify`, `plan`, `implement`, `review`, `validate`, `publish`, `blocked`, `done`) with graph-shaped role execution inside each state.
- **Background / AFK Agents** that perform roles in those workflows while the operator is away.
- **Pluggable adapters** for trackers (Linear, GitHub Issues, GitLab, Jira), harnesses (Codex, Claude Code, Cursor, custom), and model providers — each behind a typed contract, never reached around.
- **Environment-portable** deployment shape: the same core powers self-hosted, enterprise-owned, and (future) hosted-SaaS modes.

## Canonical Terms

These are the names every other doc, code symbol, and ADR uses. If a piece of code calls the same concept by a different name, the code is wrong.

| Term                          | Meaning                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Engineering Intent**        | Raw work request from Linear, Jira, GitHub, GitLab, CLI, webhook, schedule, PRD slice, or operator command.  |
| **Workflow Run**              | Durable execution instance; the core primitive.                                                              |
| **Workflow Definition**       | Reusable state-machine / graph template for executing an intent.                                             |
| **Workflow State**            | Named lifecycle point — `classify`, `plan`, `implement`, `review`, `validate`, `publish`, `blocked`, `done`. |
| **Transition**                | Explicit rule moving a run between workflow states.                                                          |
| **Background Agent**          | Category term for an autonomous engineering agent that runs outside the developer's active session.          |
| **AFK Agent**                 | Risoluto product term for a Background Agent configured to perform a role while the operator is away.        |
| **Agent Role**                | Reusable job definition — complexity analyst, planner, implementer, reviewer, tester, release operator.      |
| **Role Execution**            | One invocation of an Agent Role inside a Workflow Run.                                                       |
| **Worker Process**            | Actual harness / container / process executing the role.                                                     |
| **Artifact**                  | Durable output of a Role Execution or deterministic process.                                                 |
| **Artifact Contract**         | Typed schema / meaning of an Artifact so another role can consume it.                                        |
| **Validation Gate**           | Proof requirement before a transition can advance.                                                           |
| **Hook**                      | Extension or side-effect point in the workflow.                                                              |
| **Tracker Adapter**           | Integration layer for Linear, GitHub Issues, GitLab, Jira, etc.                                              |
| **Tracker Mirror**            | External tracker's representation of a Workflow Run.                                                         |
| **Board Projection Contract** | Tracker board semantics exposed by an adapter.                                                               |
| **Kanban Projection**         | Tracker-faithful board view plus Risoluto overlays.                                                          |
| **Operator**                  | Person running / controlling Risoluto.                                                                       |
| **Enterprise Environment**    | Customer-owned engineering environment — its own tracker, repos, CI, secrets, policies, model gateways.      |

## Architecture Principles

These are non-negotiable. A v1 PR that conflicts with one of these is wrong, even if it ships faster.

1. **Workflow Run is the core primitive, not Issue.**
2. Trackers are intake / mirror / projection adapters, **not core ownership.**
3. AFK Agents are reusable Role definitions executed per Workflow Run — not permanent named worker identities.
4. Workflows are state machines with graph-shaped Role Execution inside each state.
5. Role executions communicate through **typed Artifact Contracts.**
6. Artifacts are durable first-class records.
7. Store both **structured artifacts and raw harness-native evidence** (e.g., Codex JSONL conversation logs preserved as-is when policy allows).
8. Use an **event-sourced Run Log** with retention, redaction, and export policy.
9. **LLMs propose; deterministic orchestration disposes.**
10. **Hooks are first-class workflow primitives.**
11. **Hooks, Gates, and Transitions stay separate concepts.**
12. **Plugin boundaries are typed**, not one generic plugin interface.
13. v1 defines plugin boundaries but **does not ship an external plugin API.**
14. **Model and harness selection are explicit / name-based first** — automatic / learned selection is a later layer.
15. **Test model choices use central test model profiles** — sites pick a profile, not a specific model.
16. **Skill packs are versioned product artifacts** that live in the main repo first.

## Deployment & Enterprise Principles

- Risoluto targets **environment-portable** architecture.
- The same core supports **self-hosted, enterprise-owned, and future hosted-SaaS** modes.
- **v1 does not implement SaaS billing / tenancy.**
- v1 must **avoid hard local-only assumptions in core.**
- The technical spine **separates control plane and execution / data plane.**
- **First implementation target after foundation is single-node self-hosted.**
- Future enterprise-SaaS defaults to **customer-controlled execution plane.**
- **Raw evidence locality is policy-controlled.**
- **Secrets and model credentials resolve in the execution plane** by default.
- **Tracker credential placement is policy-based**; enterprise default is local / customer-controlled.

## Tracker & Board Principles

- **Linear-triggered dogfood** is the first serious workflow.
- **CLI-submitted intent** is the secondary core-test path to prove Linear is only an adapter.
- Tracker intake pattern is **webhook fast path + polling anti-entropy.**
- Tracker intake **attaches or updates an existing Workflow Run** by mapping; it does not duplicate runs blindly.
- A Workflow Run can have multiple **Run Attempts.**
- **Attempt Memory** prevents repeating the same errors across attempts.
- **Kanban means semantic tracker fidelity, not pixel cloning.** Tracker owns board truth; Risoluto projects it faithfully and writes changes back through the Tracker Adapter.
- Risoluto **overlays** Workflow-Run and AFK-Agent state on top of tracker projections.
- v1 documents **Board Projection** in the spine only; real implementation is backlog work.

## Memory Principles

- **Memory Builder** creates or updates structured memory from raw evidence, artifacts, failures, and operator feedback.
- **Memory Manager** decides what memory is retained, indexed, retrieved, redacted, attached, exported, or forgotten.
- **Memory behavior belongs in settings**, not hard-coded paths.
- **Memory tiers:**
  - **Attempt Memory** — same Workflow Run; always considered for retry / resume.
  - **Run Memory** — summarized lesson from completed / failed Workflow Runs; retrievable for similar future work.
  - **Project Memory** — repo-level lessons, conventions, recurring failure modes, successful patterns.
- v1 defines all three tiers; **first implementation prioritizes Attempt Memory.**
- **Memory retrieval is policy-gated.**
- **Injected memory becomes a typed `MemoryContextPack`.**
- Memory Manager must **avoid stale, secret-bearing, irrelevant, or unsafe** context injection.

## What v1 Does Not Implement (And Why)

These are explicitly **not** v1 foundation blockers. They live in the living [capability backlog](./capability-backlog.md) after the foundation is coherent.

- Full external plugin API.
- Full Board Projection implementation.
- Jira / GitLab / GitHub-Issues tracker adapter completion.
- SaaS billing / tenancy.
- Hosted control plane.
- Full Memory Manager retrieval / indexing.
- Web dashboard / frontend.
- Docs-site rebuild.
- Public skill marketplace.
- User-authored workflow DSL (TypeScript built-ins first; see [ADR-0005](./adr/0005-built-in-typescript-workflow-definitions-before-dsl.md)).

## Related Docs

- [Technical Spine](./technical-spine.md) — the v1 implementation surface.
- [Decisions Register](./decisions.md) — what we've decided and why.
- [ADRs](./adr/) — foundational, hard-to-reverse decisions.
- [Capability Backlog](./capability-backlog.md) — living post-foundation work.
