# Risoluto — Context

The single glossary for Risoluto's domain language. Every doc, code symbol, ADR, and skill uses these
names. **Where code names a concept differently, the code is wrong** — the name here is the target, the
divergent symbol is the thing to fix.

This file is a glossary and nothing else: no principles, no scope, no implementation detail. Architecture
(how code is shaped) uses a separate vocabulary — Module / Interface / Seam / Depth / Adapter — not
defined here. Product thesis, principles, and scope live in [`docs/product-spine.md`](./docs/product-spine.md).

## Language

### Execution primitives

**Workflow Run**
The durable, retryable, replayable instance of work — the core primitive everything else hangs off.
_Avoid_: Issue, ticket, job, task, "run" (unqualified).

**Engineering Intent**
A raw work request — from a tracker, the CLI, a webhook, a schedule, a PRD slice, or an operator command —
before it becomes a Workflow Run.
_Avoid_: request, prompt, task.

**Run Attempt**
One retry / resume / fanout pass of a Workflow Run. Attempts accumulate under a single run.
_Avoid_: retry (as a noun), try, session, "run".

**Operator**
The person running or controlling Risoluto.
_Avoid_: user, admin, owner.

### Workflow structure

**Workflow Definition**
A reusable state-machine / graph template for executing an intent. One definition serves many runs.
_Avoid_: workflow (unqualified), template, pipeline, config.

**Workflow State**
Where a run sits in its definition's DAG — `classify`, `plan`, `implement`, `review`, `validate`,
`publish`, `done` (plus `blocked`). Domain progress; varies per definition.
_Avoid_: status, stage, step, phase.

**Run Status**
The operational lifecycle of a run, identical for every workflow — `accepted`, `queued`, `running`,
`waiting_for_operator`, `blocked`, `done`, `cancelled`. Finite and workflow-agnostic.
_Avoid_: state, phase, stage.

**Transition**
An explicit rule moving a run between Workflow States. Distinct from a Run Status change.
_Avoid_: change, move, status update.

### Roles & execution

**Agent Role**
A reusable job definition — planner, implementer, reviewer, verifier, CI babysitter. A role is a
definition, not a permanent named worker.
_Avoid_: agent (unqualified), worker, bot.

**Background Agent**
Category term for an autonomous engineering agent running outside the developer's active session.

**AFK Agent**
Risoluto's term for a Background Agent configured to perform a role while the operator is away.

**Role Execution**
One invocation of an Agent Role inside a Workflow Run.
_Avoid_: run, job, task, dispatch.

**Worker Process**
The actual harness / container / process that executes a role.
_Avoid_: runner, session, executor.

### Artifacts & evidence

**Artifact**
A durable output of a Role Execution or a deterministic process.
_Avoid_: output, result, file.

**Artifact Contract**
The typed schema plus meaning of an Artifact, so another role can consume it. Roles communicate through
Artifact Contracts, never freeform text.
_Avoid_: schema (unqualified), format, payload.

**Run Log**
The append-only, event-sourced record of everything that happened in a Workflow Run; live state is a
projection of it.
_Avoid_: event log, history, audit trail.

**Run Log Entry**
A single durable event within the Run Log.
_Avoid_: event (unqualified), record.

### Gates, hooks, verification

A side-effect, a proof requirement, and a state change are three different concepts — keep the words apart.

**Validation Gate**
A machine pass/fail proof requirement that must pass before a Transition can advance.
_Avoid_: check, validation (unqualified), test gate.

**Verifier**
The Agent Role that judges whether the result satisfies the original Engineering Intent — not whether
checks passed, and not code quality. May run singly or as a council.
_Avoid_: reviewer, validator, checker.

**Reviewer**
The Agent Role that judges code quality. Distinct from the Verifier.
_Avoid_: verifier.

**Hook**
An extension / side-effect point in the workflow. Not a gate (a proof) and not a transition (a state change).
_Avoid_: callback, trigger, side-effect (unqualified).

### Trackers & intake

**Tracker Issue**
The upstream item in an external tracker (Linear, GitHub Issues, GitLab, Jira) that may trigger a run.
The external thing — never the run itself.
_Avoid_: Issue (unqualified), card, story.

**Tracker Adapter**
The integration layer that turns a tracker into intake, mirror, and projection — never core ownership.
_Avoid_: integration, connector, plugin.

**Tracker Mirror**
An external tracker's representation of a Workflow Run (the run reflected back onto the tracker).
_Avoid_: Issue (as a peer of Workflow Run), projection (unqualified).

**Board Projection Contract**
The tracker board semantics an adapter exposes. Risoluto projects board truth faithfully; it does not own it.

**Run Config Override**
Operator-authored, per-Tracker-Issue defaults (e.g. model, prompt template) that survive across Run
Attempts and resolve into a Workflow Run at dispatch. Keyed by tracker identity because it is set before any
run exists.
_Avoid_: issue config, settings.

### Scheduling & memory

**Pending Retry Slot**
A scheduled-but-not-yet-started retry of a Workflow Run — the timer-backed gap between two Run Attempts.
Distinct from a Run Attempt, which is an actual execution pass.
_Avoid_: retry entry, retry.

**Attempt Memory** · **Run Memory** · **Project Memory**
The three memory tiers. Attempt Memory is scoped to one Workflow Run and always considered on retry; Run
Memory is a summarized lesson from completed/failed runs; Project Memory is repo-level conventions and
recurring patterns.

**Memory Builder** / **Memory Manager**
The Builder creates/updates structured memory from evidence; the Manager decides what is retained, indexed,
retrieved, redacted, attached, exported, or forgotten.

### Environment

**Enterprise Environment**
A customer-owned engineering environment — its own tracker, repos, CI, secrets, policies, and model gateways.

## Flagged ambiguities

These words are overloaded across the codebase. On any interface shared across a boundary, **qualify the
word** — never use it bare.

- **status** — means Run Status, attempt outcome, automation status, health, alert delivery, HTTP code,
  gate result, or PR state depending on context. Write `workflowRunStatus`, `attemptStatus`, `healthStatus`,
  `gateStatus` — never bare `status`.
- **state** — Workflow State (a DAG node) vs a Tracker Issue's board column vs the state-machine that
  bridges them. Use `workflowStateId` / `stageId` for the DAG node, `trackerState` for the board column;
  reserve bare `state` for the bridging machine.
- **run** — as a noun it is Workflow Run, Automation Run, or Run Attempt; as a verb it just means "execute."
  Always qualify the noun (`workflowRun`, `automationRun`). CLI verbs (`run start`) are fine.
- **transition** — Workflow State Transition vs Run Status Transition vs a Tracker board transition. Use
  `WorkflowStateTransition`, `RunStatusTransition`, `TrackerStateTransition`.
- **gate** — a Validation Gate (a runtime proof) vs a board "approval/hold" column vs the pipeline's
  pre-PR "verification step." Reserve **gate** for the Validation Gate; call the others "approval column" and
  "verification step."
- **Issue** — the external **Tracker Issue** vs the legacy habit of using `issueId` as a Workflow Run's own
  key. `issueId` / `issueIdentifier` are **Tracker Issue coordinates** (the adapter's UUID and human slug,
  e.g. `ENG-123`), never an alias for the Workflow Run id. A run's identity is its own `wr_*` id.

## Build-time planning vocabulary

These name the operator's research-to-shipping tooling — **not** runtime product concepts. They never ship
as Workflow Run primitives. Kept here only so the runtime terms above are not confused with them.

**Research Wiki** — the connected knowledge base of captured research that the Idea Engine mines.
**Idea Engine** — gap-grounded, cite-or-drop idea generation over the Research Wiki.
**Candidate Feature** — a per-source feature extracted and deduped before it enters the critic-grill.
**Pipeline Coordination Store** — the tracker (Linear) used as shared state across planning-pipeline skills,
so nothing is lost across stage handoffs. Distinct from the runtime Memory tiers.
_Avoid_: "memory layer" for this — that collides with Attempt/Run/Project Memory.
**slug** · **PRD** · **wave** · **bundle** — the join key, the spec, a milestone group, and a parallel-safe
unit of work in the planning pipeline.

## Example dialogue

> **Dev:** A Linear ticket came in — does that create the Issue directly?
> **Domain expert:** It creates a **Workflow Run**. The Linear ticket is a **Tracker Issue** — an external
> thing the **Tracker Adapter** takes as intake. The run is the primitive; the ticket is just where the
> **Engineering Intent** arrived.
> **Dev:** So when the run is `running`, that's its Workflow State?
> **Domain expert:** No — `running` is its **Run Status**, the operational lifecycle. Its **Workflow State**
> is where it sits in the DAG, like `implement` or `review`. Two different axes.
> **Dev:** The implement step failed its tests and retried. Two Run Attempts?
> **Domain expert:** One Run Attempt that failed, then a **Pending Retry Slot** until the timer fired, then
> a second Run Attempt. The tests are a **Validation Gate** — a machine pass/fail. Whether the work actually
> met the intent is a separate judgment the **Verifier** makes; code quality is the **Reviewer's** call.
> **Dev:** And the per-ticket model override the operator set?
> **Domain expert:** That's a **Run Config Override** — keyed by the Tracker Issue because it was set before
> any run existed, and it survives across attempts.
