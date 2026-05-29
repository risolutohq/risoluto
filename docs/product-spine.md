# Risoluto — Product Spine

> **Identity.** Risoluto is **workflow-run-centered background agent orchestration for engineering
> work.** Engineering intent — a tracker issue, a PRD slice, a schedule, a webhook, an operator
> command — becomes a durable **Workflow Run** executed by reusable **Agent Roles** across pluggable
> trackers, harnesses, and model providers.

This is the authority document for what Risoluto **is** and the vocabulary every other doc, ADR, and
code symbol must use. Where code names a concept differently, the code is wrong. Where this spine
states intent the runtime has not yet reached, [`adr/0001-foundation.md`](./adr/0001-foundation.md)
carries the honest as-built status tables — read them before trusting any "is" here as "ships today."

## What Risoluto is

A workflow-run engine for autonomous engineering work:

- A **Workflow Run** — the durable, retryable, replayable unit of execution. The core primitive.
- **Workflow Definitions** — reusable templates for how work flows through named states
  (`classify → plan → implement → review → validate → publish → done`, plus `blocked`), with
  graph-shaped role execution _inside_ each state.
- **Background / AFK Agents** — perform roles in those workflows while the operator is away.
- **Pluggable adapters** — trackers (Linear, GitHub Issues, GitLab, Jira), harnesses (Codex, Claude
  Code, Cursor, custom), and model providers — each behind a typed contract that is never reached
  around.
- **Environment-portable** — one core powers self-hosted, enterprise-owned, and (future) hosted-SaaS
  deployments.

The single-operator overnight-solo "personal autonomous coder" loop is **the first reference
Workflow Definition Risoluto targets — not the identity.** Other definitions ride the same primitives.

## The jobs Risoluto exists to serve (value lens)

Risoluto's value to an operator running agents AFK reduces to **five jobs**. Every roadmap
candidate is held against this lens: name which job it deepens. A candidate that maps to none of
these is a shiny object, not a roadmap item — the mapping failure is itself the signal to drop it.

| Job                            | What it means for an AFK operator                                |
| ------------------------------ | ---------------------------------------------------------------- |
| **Observability & trust**      | Knowing what the agents did while away, without having to watch. |
| **Failure recovery**           | Detecting, isolating, and resuming after a run or role fails.    |
| **Cost control**               | Bounding token, compute, and time spend on unattended runs.      |
| **Coordination & parallelism** | Many agents / runs progressing without colliding.                |
| **Review & handoff on return** | Surfacing exactly what needs the operator when they come back.   |

This lens is the **value** axis; the architecture principles below are the **fit** axis. A
candidate must satisfy both — serve a real job _and_ compose with the primitives — before it earns a
roadmap row. The critic-grill (Mode A) and the ingest idea-engine (Mode B) both apply it; see
[`research-to-shipping-pipeline.md`](./research-to-shipping-pipeline.md). This is the project's
product thesis made operational: principle #9 says LLMs propose and the founder disposes — this lens
is _what_ the founder disposes against.

## Canonical terms

The shared glossary. Every doc, symbol, and ADR uses these names; divergent code is the thing to fix.

| Term                          | Meaning                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Engineering Intent**        | Raw work request from Linear, Jira, GitHub, GitLab, CLI, webhook, schedule, PRD slice, or operator command.                                                                          |
| **Workflow Run**              | Durable execution instance; the core primitive.                                                                                                                                      |
| **Workflow Definition**       | Reusable state-machine / graph template for executing an intent.                                                                                                                     |
| **Workflow State**            | Named lifecycle point — `classify`, `plan`, `implement`, `review`, `validate`, `publish`, `blocked`, `done`.                                                                         |
| **Transition**                | Explicit rule moving a run between workflow states.                                                                                                                                  |
| **Run Attempt**               | One retry / resume / fanout pass of a Workflow Run; attempts accumulate under one run.                                                                                               |
| **Background Agent**          | Category term for an autonomous engineering agent running outside the developer's active session.                                                                                    |
| **AFK Agent**                 | Risoluto product term for a Background Agent configured to perform a role while the operator is away.                                                                                |
| **Agent Role**                | Reusable job definition — complexity analyst, planner, implementer, reviewer, tester, release operator.                                                                              |
| **Role Execution**            | One invocation of an Agent Role inside a Workflow Run.                                                                                                                               |
| **Worker Process**            | The actual harness / container / process executing a role.                                                                                                                           |
| **Artifact**                  | Durable output of a Role Execution or deterministic process.                                                                                                                         |
| **Artifact Contract**         | Typed schema + meaning of an Artifact so another role can consume it.                                                                                                                |
| **Validation Gate**           | Proof requirement that must pass before a transition can advance.                                                                                                                    |
| **Hook**                      | Extension / side-effect point in the workflow.                                                                                                                                       |
| **Tracker Adapter**           | Integration layer for Linear, GitHub Issues, GitLab, Jira, etc.                                                                                                                      |
| **Tracker Mirror**            | An external tracker's representation of a Workflow Run.                                                                                                                              |
| **Board Projection Contract** | Tracker board semantics exposed by an adapter.                                                                                                                                       |
| **Operator**                  | The person running / controlling Risoluto.                                                                                                                                           |
| **Enterprise Environment**    | Customer-owned engineering environment — its own tracker, repos, CI, secrets, policies, model gateways.                                                                              |
| **Research Wiki**             | Connected knowledge base of captured research at `research/wiki/`, built by the `risoluto-ingest` skill; the substrate the Idea Engine mines.                                        |
| **Idea Engine**               | Gap-grounded, cite-or-drop idea generation over the Research Wiki (Mode B of the research pipeline); emits candidate roadmap rows only when the idea cites the dots it connects.     |
| **Candidate Feature**         | A per-source feature the `risoluto-researcher` skill extracts and dedups against the roadmap and already-shipped features (Mode A); survives dedup before entering the critic-grill. |

> **Planning surfaces, not runtime surfaces.** Research Wiki, Idea Engine, and Candidate Feature are
> operator build-tooling concepts — parts of the research-to-shipping pipeline the operator uses to
> decide what to build next. They are not Workflow Run primitives and do not ship as end-user product
> features. This reflects principle #9: LLMs propose; deterministic orchestration / the founder
> disposes. Skills may append proposed roadmap rows; the founder ranks, promotes, and kills them.

## Architecture principles (non-negotiable)

A v1 change that violates one of these is wrong, even if it ships faster.

1. **Workflow Run is the core primitive, not Issue.**
2. Trackers are intake / mirror / projection adapters — **not core ownership.**
3. AFK Agents are reusable Role definitions executed per Workflow Run — not permanent named workers.
4. Workflows are state machines with **graph-shaped Role Execution inside each state.**
5. Role executions communicate through **typed Artifact Contracts**, never freeform text.
6. Artifacts are durable, first-class records.
7. Store both **structured artifacts and raw harness-native evidence** (e.g. Codex JSONL, preserved as-is when policy allows).
8. Live state is a **projection of an event-sourced Run Log**, with retention / redaction / export policy — not a parallel mutable write.
9. **LLMs propose; deterministic orchestration disposes.**
10. **Hooks, Gates, and Transitions stay separate concepts** — a side-effect, a proof requirement, and a state change are not the same code path.
11. **Plugin boundaries are typed**, not one generic plugin interface; v1 defines them but ships **no external plugin API.**
12. **Model and harness selection are explicit / name-based first** — automatic / learned selection is a later layer.
13. **Test sites pick a central model _profile_**, not a specific model.
14. **Skill packs are versioned product artifacts** that live in the main repo first.

## Deployment & environment

- Architecture is **environment-portable**; the same core supports self-hosted, enterprise-owned, and future hosted-SaaS modes.
- **v1 does not implement SaaS billing or tenancy**, and core carries **no hard local-only assumptions.**
- The architecture **separates control plane from execution / data plane.** Control plane owns run identity, scheduling, definitions, observability, and operator surfaces; the execution plane owns role execution, harness lifecycle, secrets, and raw evidence.
- **First implementation target after foundation is single-node self-hosted.** Future enterprise-SaaS defaults to a **customer-controlled execution plane.**
- **Secrets and model credentials resolve in the execution plane** by default; **raw evidence locality and tracker-credential placement are policy-controlled.**

## Trackers & board

- **Linear-triggered dogfood** is the first serious workflow; **CLI-submitted intent** is the secondary path that proves a tracker is only an adapter.
- Tracker intake is **webhook fast-path + polling anti-entropy**, and **attaches/updates an existing run by mapping** — it never blindly duplicates runs.
- A Workflow Run can have multiple **Run Attempts**; **Attempt Memory** stops repeated errors across them.
- **Kanban means semantic tracker fidelity, not pixel cloning.** The tracker owns board truth; Risoluto projects it faithfully, overlays run/agent state, and writes changes back through the adapter.
- v1 documents **Board Projection** here only; implementation is [roadmap](./roadmap.md) work.

## Memory

- **Memory Builder** creates/updates structured memory from evidence, artifacts, failures, and operator feedback; **Memory Manager** decides what is retained, indexed, retrieved, redacted, attached, exported, or forgotten.
- **Memory behavior lives in settings**, not hard-coded paths; retrieval is **policy-gated**; injected memory becomes a typed `MemoryContextPack`.
- **Three tiers**, all defined in v1, **Attempt Memory implemented first:**
  - **Attempt Memory** — same Workflow Run; always considered for retry / resume.
  - **Run Memory** — summarized lesson from completed / failed runs; retrievable for similar work.
  - **Project Memory** — repo-level conventions, recurring failure modes, successful patterns.
- Memory Manager must avoid stale, secret-bearing, irrelevant, or unsafe context injection.

## What v1 does not implement

This is the **single home** for v1's out-of-scope list — other docs point here rather than restate
it. These are not foundation blockers; each enters [`roadmap.md`](./roadmap.md) when an
operator-observed need is real.

- Full external plugin API.
- Full Board Projection implementation (contract only in v1).
- Jira / GitLab / GitHub-Issues tracker adapter completion (Linear first).
- SaaS billing / tenancy; hosted control plane.
- Full Memory Manager retrieval / indexing across tiers.
- Web dashboard / frontend; docs-site rebuild.
- Public skill marketplace.
- Multi-tenant surfaces (no tenancy in v1).
- User-authored workflow DSL — built-in TypeScript definitions first ([ADR §5](./adr/0001-foundation.md#5-built-in-typescript-workflow-definitions-before-a-user-authored-dsl)).

## Related docs

- [Technical Spine](./technical-spine.md) — the implementation surface and boundary rules.
- [Roadmap](./roadmap.md) — the single ordered plan of what's next.
- [Research → Shipping Pipeline](./research-to-shipping-pipeline.md) — how a roadmap item becomes merged code.
- [Decisions](./decisions.md) + [ADRs](./adr/) — what we decided and why.
- [Testing & Release](./testing-and-release.md) — test tiers and the `1.0.0` gate.
