# ADR-0001: Risoluto v1 Foundation (Consolidated)

- **Status:** Accepted
- **Date:** 2026-05-29
- **Supersedes:** the former ADR-0001 … ADR-0007, now merged into this single file.

## How to read this document

This is the consolidated foundation record for Risoluto v1. It holds seven
decisions. Each decision is written in **intent voice** — it states what the
architecture _is meant to be_. The intent is durable and still holds even where
the code has not caught up.

Immediately after each decision, an **Implementation status** table maps every
atomic claim to its as-built reality. Read the table before you trust the prose.

| Status            | Meaning                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **Delivered**     | Implemented and verified in code at the cited location.                                   |
| **Partial**       | Implemented for a narrower scope, or differently, than the decision states.               |
| **Not delivered** | Decided, not yet built. A target — not current behavior. Safe, as long as you know it.    |
| **⚠ Drifted**     | Code currently does the **opposite** of the decision. Reconcile before relying on either. |

Status verified against source on **2026-05-29**. If you change behavior, update
the matching row in the same commit — a current table is the contract that keeps
the next agent from building on a claim that isn't true. The **⚠ Drifted** rows
are the reconciliation backlog; see [Where to reconcile first](#where-to-reconcile-first).

---

## 1. Workflow Run as Core Primitive

### Context

The pre-v1 implementation treated **Issue** (a Linear issue) as the core domain
object — worker lifecycle, attempt storage, dispatch, and persistence all keyed
on issue identity. That made a second tracker a translation problem instead of an
adapter problem, made non-tracker intake (CLI, schedule, PRD slice, webhook)
awkward, made multi-attempt semantics inconsistent, and drifted the system's
identity toward "Linear automation" instead of "engineering work orchestration."

### Decision

The core primitive **is Workflow Run** — a durable, retryable, replayable
execution instance of a **Workflow Definition** triggered by an **Engineering
Intent**. Trackers are intake / mirror / projection **adapters**; they do not own
the work. Persistence, dispatch, scheduling, and observability **shall** key off
Workflow Run identity, and tracker items **shall** map to Workflow Runs through a
mapping table — not via primary-key equality. A Workflow Run **shall** carry
multiple Run Attempts (retry / fanout / resume).

### Implementation status

| Claim                                                                        | Status        | Evidence                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow Run is a named, durable primitive with its own records and archive  | Delivered     | `src/workflow-run/` (archive keyed on `workflowRunId`)                                                                                                                                      |
| A run can have multiple Run Attempts                                         | Delivered     | `src/workflow-run/run-attempts.ts`; projection in `run-attempt-projection.ts`                                                                                                               |
| Attempt reasons cover retry and resume                                       | Delivered     | enum `"initial" \| "retry" \| "resume"` (`workflow-run/contracts.ts:77`)                                                                                                                    |
| All persistence / dispatch / scheduling / observability key off run identity | ⚠ Drifted     | SQLite tables key on `attempt_id` / `issue_id`; **no `workflow_run_id` column** (`persistence/sqlite/schema.ts:17-81`); dispatch falls back to `issue.id` (`dispatch/server.ts:55`)         |
| Tracker items map to runs via a mapping table, not PK identity               | ⚠ Drifted     | No mapping table; `issueIndex` maps `issue_identifier → latest_attempt_id`; `workflowRunReferenceFromIssue` copies `issue.id` straight in (`orchestrator/run-lifecycle-coordinator.ts:392`) |
| Workflow Definitions are reusable templates expressed as state machines      | ⚠ Drifted     | `WorkflowDefinition = { config, promptTemplate }` — a config bag (`core/types.ts:95`). The real `StateMachine` (`state/machine.ts`) governs Linear issue states, not run flow               |
| "Fanout" attempts                                                            | Not delivered | "fanout" is absent from the attempt-reason enum                                                                                                                                             |

### Consequences

Tracker pluralism becomes an adapter problem, not a core refactor. Non-tracker
intake is first-class. Multi-attempt semantics live where they belong. **Cost:**
the run-vs-issue identity split is the largest open drift — today the orchestrator
collapses the two, so most of the primitive's promised payoff is not yet realized.

### Alternatives considered

- **Keep Issue as primitive, add a "WorkflowAttempt" sub-concept.** Rejected:
  leaves the system Linear-shaped and bakes "tracker == truth" into every layer.
- **Generic "Job" primitive.** Rejected: too thin; hides the workflow / state /
  role / artifact vocabulary that makes Risoluto useful.
- **Two parallel primitives (Issue and WorkflowRun) during transition.**
  Rejected: doubles the data model and test matrix; one reliably atrophies.

---

## 2. State Machine with Graph Execution Inside States

### Context

A Workflow Definition needs to express both **outer lifecycle progression**
(`classify → plan → implement → review → validate → publish → done`) and
**intra-state structure** (within `implement`, planner → implementer → tester
hand work to each other). Pure state machines force role flow into state
explosion; pure DAGs lose the discrete lifecycle that makes gates and tracker
projection meaningful.

### Decision

A Workflow Definition **is** a state machine of named Workflow States. Inside each
state, Role Execution **shall be** a typed DAG of Agent Roles connected by Artifact
Contracts. Outer transitions **shall be** gated by Validation Gates and triggered
by Transitions. Hooks **shall** fire at state entry / exit and at named DAG nodes.

### Implementation status

| Claim                                                     | Status        | Evidence                                                                                                                                                                                                             |
| --------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A working state machine of named stages exists            | Partial       | `StateMachine` is real (`state/machine.ts:129`) but models **Linear issue states** (board columns), not workflow-run lifecycle                                                                                       |
| Outer transitions are enforced                            | Delivered     | `assertTransition` / `canTransition` (`state/machine.ts:155`), `state/topology.ts:64`, `http/transition-handler.ts:21`                                                                                               |
| Transition / gate / hook events are recorded              | Delivered     | `recordWorkflowRunTransition` writes `validation_gate.evaluated` / `workflow_transition.applied` / `workflow_hook.fired` (`workflow-run/artifacts.ts:113`)                                                           |
| Inside each state, Role Execution is a typed DAG of roles | Not delivered | No DAG structure anywhere (no `RoleNode` / `dependsOn` / topological sort). `dag_node` is only a hook-timing string (`workflow-run/contracts.ts:87`); roles are flat named events (`role-execution-artifacts.ts:11`) |
| Validation Gates evaluate conditions                      | ⚠ Drifted     | A gate is a label `{ name, status }` (`contracts.ts:80`); the caller passes pass/fail. No gate engine evaluates anything                                                                                             |
| Hooks fire autonomously at entry / exit / DAG node        | ⚠ Drifted     | Hook timings are _recorded by CLI callers_ (`cli/workflow-run-command.ts:307`); nothing fires them, and `dag_node` has no DAG behind it                                                                              |

### Consequences

When the inner DAG lands, outer lifecycle stays legible to operators and tracker
projections while inner role choreography stays expressive. **Cost:** two
structural models to keep coherent — and today only the outer one (over issue
states) exists; the inner role DAG is the single biggest unbuilt architectural
claim in this document.

### Alternatives considered

- **Pure state machine (no intra-state DAG).** Rejected: forces role
  choreography into flat sequential roles or state explosion.
- **Pure DAG (no outer state machine).** Rejected: loses operator-legible
  lifecycle and makes gates / tracker projection harder.
- **Hierarchical state machine (states-within-states).** Rejected: solves
  recursion but not parallel role execution.

---

## 3. Typed Artifact Contracts Between Role Executions

### Context

Agent Roles hand work to each other (planner → implementer → reviewer → release
operator). If the handoff is freeform text, every downstream role becomes a
fragile prompt-engineering exercise, cross-role tests become brittle, replay
loses meaning, and a Memory Builder cannot reliably extract lessons.

### Decision

Every artifact a Role Execution produces or consumes **shall be** bound to a
typed **Artifact Contract** — a schema (TypeScript type + runtime validator) plus
a meaning description. Contracts **shall be** versioned. A role **shall** declare
the contracts it consumes (inputs) and produces (outputs). The runtime **shall**
validate artifacts against their contract **at production time, not consumption
time**, so failures attribute to the producer. Raw harness-native evidence (e.g.,
Codex JSONL) **shall be** stored alongside but separately from contract-bound
artifacts.

### Implementation status

| Claim                                                                     | Status        | Evidence                                                                                                                       |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Artifacts carry a `contractId` identifier                                 | Delivered     | `WorkflowRunArtifactReference.contractId` (`workflow-run/contracts.ts:69`)                                                     |
| A contract is a TS type + runtime validator + meaning                     | Not delivered | `data: unknown` is written raw; `contractId` is just a stored string — no schema, no validator (`workflow-run/archive.ts:194`) |
| Contracts are versioned                                                   | Not delivered | Only a `.v1` naming convention appears in a test; no version field, registry, or migration                                     |
| A role declares the contracts it consumes (inputs) and produces (outputs) | ⚠ Drifted     | Only a single **output** `artifactContractId` is recorded; there is no input declaration (`role-execution-artifacts.ts:25`)    |
| Validation happens at production time, not consumption time               | Not delivered | No validation happens at any time                                                                                              |
| Raw harness evidence (Codex JSONL) stored separately                      | Not delivered | No capture path writes Codex session JSONL into the workflow-run archive                                                       |

### Consequences

When contracts carry validators, cross-role testing becomes real (synthesize a
valid input, run the role, validate the output) and replay / Memory Builder get
structured surfaces. **Cost:** contract drift becomes a thing to manage. Today
the "contract" is an opaque string, so none of the testing or replay payoff
exists yet.

### Alternatives considered

- **Freeform text handoff.** Rejected: fragility scales worse-than-linearly with
  role count.
- **JSON-without-schema.** Rejected: looks structured, behaves freeform — which
  is, notably, the current as-built state and explicitly _not_ the target.
- **Contracts only at workflow boundaries.** Rejected: hides intra-state coupling.

---

## 4. Event-Sourced Run Log with Retention / Redaction / Export Policy

### Context

A Workflow Run accumulates state transitions, role executions, artifact
creations, hook firings, gate evaluations, retries, errors, harness output, and
model calls. The system needs replay, audit, export, and redaction. A mutable
snapshot cannot serve replay or audit; an append-only log can — _provided the
same log is the source of truth for live state, not a parallel write._

### Decision

Workflow Run state **shall be** derived from an event-sourced **Run Log**. The Run
Log is append-only; live state is a **projection** of the log, not a separate
write. Each event **shall** have a typed payload and a monotonic sequence.
Retention policy **shall be** per-Workflow-Definition (with environment
overrides). Redaction policy **shall** strip fields by classification
(secret / PII / cost / freeform) before export. Export **shall** emit a
self-contained replayable bundle (events + referenced artifacts).

### Implementation status

| Claim                                                   | Status        | Evidence                                                                                                                                             |
| ------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Append-only JSONL event log per run                     | Delivered     | `workflow-run/archive.ts` uses `appendFile`; never overwrites                                                                                        |
| Attempt summaries are projected from the log            | Delivered     | `workflow-run/run-attempt-projection.ts`                                                                                                             |
| Events carry a monotonic sequence                       | Delivered     | `archive.ts:133` computes `max(existing) + 1`                                                                                                        |
| Live state is a projection, not a separate write        | ⚠ Drifted     | A parallel mutable write exists: SQLite `attempts` rows are updated in place via `updateAttempt()` (`persistence/sqlite/attempt-store-sqlite.ts:78`) |
| Events have typed (discriminated) payloads              | Partial       | `WorkflowRunEventRecord` is one wide all-optional-field bag, and `sequence` is typed optional — not a discriminated union per event type             |
| Retention is per-Workflow-Definition with env overrides | Not delivered | Only a hardcoded 7-day window for cost samples; no per-definition retention                                                                          |
| Redaction strips by classification before export        | ⚠ Drifted     | Redaction is regex key-name matching on live event content (`core/content-sanitizer.ts:1`), not classification, and not at export time               |
| Export emits a self-contained replayable bundle         | Not delivered | No export-bundle function exists anywhere in the tree                                                                                                |

### Consequences

When live state is genuinely projected from the log, the "live state vs log"
divergence bug class disappears and replay / audit / export / Memory Builder all
consume one surface. **Cost:** historical-event schema migration is real work and
retention becomes mandatory. Today the SQLite mutable write is the divergence risk
the decision exists to eliminate.

### Alternatives considered

- **Mutable state record with a parallel audit log.** Rejected: double-write
  divergence is inevitable. (This is effectively the current as-built state.)
- **CRDT-based run state.** Rejected: complexity unjustified for a
  single-writer-per-run workload.
- **File-based JSONL only (no DB projection).** Rejected: live operator surfaces
  need indexed reads.

---

## 5. Built-In TypeScript Workflow Definitions Before a User-Authored DSL

### Context

Risoluto's value depends on Workflow Definitions — the planner → implementer →
reviewer pipeline, the fanout-and-grade pipeline, the spec-first interviewer
pipeline. Operators will eventually want to author their own; a DSL is the
natural shape. Designing the DSL before the first built-ins exist would encode
guesses about which primitives, contracts, and hooks actually matter.

### Decision

v1 **ships** built-in TypeScript Workflow Definitions as typed records (state
machine + role DAG + artifact contracts) in the main repo. **No user-authored
workflow DSL in v1.** Operators **select** definitions by name and **tune** via
parameters, not authoring. The DSL is a deferred decision (decisions.md #27),
triggered after at least three built-in definitions ship and authoring pain is
observed.

### Implementation status

| Claim                                                     | Status        | Evidence                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No user-authored workflow DSL exists in v1                | Delivered     | No DSL parser / loader / authoring surface anywhere in `src/`                                                                                                                                 |
| v1 ships the first three built-in TS Workflow Definitions | ⚠ Drifted     | **Zero** definitions exist. Only the string `DEFAULT_WORKFLOW_DEFINITION_ID = "single-operator-afk-coder"` (`workflow-run/contracts.ts:1`); no backing record, no fanout-grade, no spec-first |
| Operators select definitions by name                      | Partial       | `--workflow-definition` flag is accepted (`cli/workflow-run-command.ts:128`) but never resolved against a registry — any string passes                                                        |
| Operators tune definitions via parameters                 | Not delivered | No parameter mechanism for definitions exists                                                                                                                                                 |

> **Foundation warning.** ADR-0005's own deferral trigger — "after at least three
> built-in definitions ship" — currently rests on **zero** shipped definitions.
> The DSL deferral is therefore effectively unbounded until the first real
> built-in lands. An agent must not read "v1 ships built-in definitions" as fact.

### Consequences

When real built-ins exist, the eventual DSL encodes observed patterns instead of
imagined ones, and v1 ships concrete dogfooded shapes. **Cost:** until then, the
"definition" is a name string with no behavior, and the deferral has no trigger
floor.

### Alternatives considered

- **Ship the DSL in v1.** Rejected: premature; encodes guesses.
- **No built-in definitions; operators always write code.** Rejected: defeats the
  product.
- **YAML / JSON descriptor as a half-step.** Rejected: behaves like a DSL without
  the type system.

---

## 6. Environment-Portable Control Plane / Execution Plane Split

### Context

v1's product is **single-node self-hosted**. But the long-term shape includes
**enterprise-owned** (customer runs execution, optionally consumes a hosted
control plane) and **hosted SaaS** (Risoluto runs control plane, customer runs
execution). Hard-coding "both planes on one host" into v1 closes those doors
expensively.

### Decision

The architecture **shall** separate the control plane from the execution / data
plane from v1 onward. The **control plane** owns Workflow Run identity,
scheduling, Workflow Definitions, observability aggregation, and operator surfaces
(CLI / TUI / HTTP). The **execution plane** owns Role Execution, harness
lifecycle, model / provider credentials, raw evidence, and secret material. The
interface between them **shall be** a network-shaped contract, not in-process
function calls. Secrets and model credentials **shall** resolve in the execution
plane by default. Raw evidence locality **shall be** policy-controlled.

### Implementation status

| Claim                                                      | Status        | Evidence                                                                                                                                                    |
| ---------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dispatcher seam separates the planes                     | Delivered     | `RunAttemptDispatcher` (`dispatch/types.ts:21`); `AgentRunner` (local) + `DispatchClient` (remote)                                                          |
| A network-shaped contract (HTTP + SSE) exists              | Delivered     | `dispatch/client.ts:113` (`fetch` + `text/event-stream`); `dispatch/entrypoint.ts` (Express server)                                                         |
| Control plane owns CLI + HTTP operator surfaces            | Delivered     | `cli/`, `http/server.ts` (full route + OpenAPI surface)                                                                                                     |
| The interface is network-shaped by default, not in-process | ⚠ Drifted     | `DISPATCH_MODE` defaults to `"local"` → in-process call (`dispatch/factory.ts:34`, `orchestrator/worker-launcher.ts:534`). Default deployment is a monolith |
| Secrets resolve in the execution plane by default          | ⚠ Drifted     | `SecretsStore` is a control-plane singleton; resolved values are shipped to the data plane inside the dispatch config (`cli/services.ts:95`)                |
| Model credentials resolve execution-side                   | Partial       | Read from `process.env` at container spawn (`docker/spawn.ts:91`); execution-side only when `DISPATCH_MODE=remote`                                          |
| Control plane owns a TUI                                   | Not delivered | No TUI exists anywhere in the tree (TUI is "next" per AGENTS.md, not built)                                                                                 |
| Raw evidence locality is policy-controlled                 | Not delivered | No evidence-locality policy / config key exists                                                                                                             |

### Consequences

When the network seam is the default, enterprise and SaaS modes become deployment
problems, not refactors, and the security posture (secrets with the executor) is
correct from the start. **Cost:** even today the seam carries real serialization
work. The decision holds, but the default-local mode and control-plane secret
resolution mean the security posture the ADR promises is not yet the one in force.

### Alternatives considered

- **Tightly couple v1; refactor when SaaS / enterprise demand lands.** Rejected:
  retrofitting distributed seams is expensive and risky.
- **Build SaaS-shaped from day one.** Rejected: complexity without grounding
  customer demand.
- **Process-level isolation only (single host, two processes, IPC).** Rejected:
  doesn't prove network-shape correctness; bakes localhost assumptions.

---

## 7. Research-to-Shipping Planning Pipeline

> **Update 2026-05-29 (decision [#30](../decisions.md)).** The model below describes the original
> pipeline: auto-synthesized idea clusters in `capability-backlog.md` + `research/ideas/`. That layer
> was reset — the single plan is now a hand-owned [`docs/roadmap.md`](../roadmap.md); research is
> optional input and the synthesizer's auto-plan role is retired. The core decision (PRDs canonical in
> git, flat Linear issues with blocked-by, fork-not-upgrade skills, manual `/tdd`) still holds; only
> the **plan source** changed. Current flow:
> [`research-to-shipping-pipeline.md`](../research-to-shipping-pipeline.md). Skill rewiring to the
> roadmap is Phase C (not yet done).

### Context

The v1 planning surface evolved ad-hoc: research in Obsidian, ideas in a flat
backlog, manual tool-switching from "interesting cluster" to "shipped PR." The
operator needed a repeatable, auditable pipeline. The seam between planning and
runtime is the **Linear ticket**, not the harness.

### Decision

Risoluto ships a five-phase planning pipeline as composable skills + CI
automations:

| Phase | Skill / Automation                      | Artifact                                              |
| ----- | --------------------------------------- | ----------------------------------------------------- |
| 1     | `risoluto-researcher`, `risoluto-vault` | `research/targets/<slug>/` + sources                  |
| 2     | `risoluto-synthesizer`                  | `research/ideas/<slug>/` + backlog row                |
| 3     | `risoluto-grill`, `risoluto-to-prd`     | Grilled idea + `docs/prds/<slug>.md` + Linear Project |
| 4     | `risoluto-to-issues`, `risoluto-tdd`    | Linear Issues + PRs with `from:prd-*` labels          |
| 5     | Post-merge workflow                     | PRD `status: shipped` + Linear back-comments          |

Key decisions: **PRDs are canonical in git** (Linear descriptions are generated
mirrors; a pre-push hook blocks drift). **Flat issues with blocked-by relations**
(no parent-child nesting). **LLM-inferred slice graphs** (non-deterministic;
operator reviews before issue creation). **Fork-not-upgrade** (Linear-specific
behavior lives in `skills/risoluto-*`; global skills stay generic). **Manual
`/tdd <ticket-ref>`** (runtime auto-pickup deferred behind the `auto:runtime`
label seam).

### Implementation status

| Claim                                                         | Status    | Evidence                                                                                                                                                                         |
| ------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All seven pipeline skills exist as real skill dirs            | Delivered | `skills/risoluto-{researcher,vault,synthesizer,grill,to-prd,to-issues,tdd}/SKILL.md`                                                                                             |
| PRDs canonical in git, Linear descriptions mirrored           | Delivered | `docs/prds/README.md`; `risoluto-to-prd/SKILL.md`                                                                                                                                |
| A pre-push hook detects PRD drift and blocks the push         | Delivered | `.husky/pre-push` → `prd:drift-check` → `scripts/prd-drift-check.ts` (runs unconditionally; `SKIP_HOOKS` does not bypass it)                                                     |
| The drift check requires `LINEAR_API_KEY`                     | Delivered | `scripts/prd-drift-check.ts` (`requireApiKey`, hard `exit 1` if unset)                                                                                                           |
| Flat issues with blocked-by relations, no nesting             | Delivered | `risoluto-to-issues/SKILL.md`                                                                                                                                                    |
| Post-merge automation flips PRD status + back-comments Linear | Delivered | `scripts/post-merge-prd.mjs`, wired to CI in `.github/workflows/post-merge.yml` (`pull_request: closed`, `merged == true`) — **CI-only, not the local `.husky/post-merge` hook** |
| Skills are wired via symlink into `~/.claude/skills`          | Partial   | Repo-local dirs only; discovered via project-level skill loading, not symlinked into the global dir                                                                              |
| The pipeline has been dogfooded end to end                    | Partial   | One PRD exists (`docs/prds/provider-abstraction.md`, `status: draft`); Phase 4 (`to-issues` / `tdd`) never exercised to completion                                               |

### Consequences

The path from raw research to merged PR is repeatable and auditable; the Linear
ticket is the swappable joint between planning and implementation. **Cost:** the
pipeline is operator-driven (explicit invocation per phase), the slice graph is
non-deterministic, and `git push` now depends on `LINEAR_API_KEY`.

### Alternatives considered

- **Single-vault model (research in personal Obsidian).** Rejected: research
  artifacts are project-specific and should version with the repo.
- **GitHub Issues instead of Linear.** Rejected: Linear's blocked-by relations,
  project descriptions, and GraphQL API fit the pipeline better. GitHub Issues
  remains public intake / mirror only (Decision #6).
- **Deterministic YAML post-merge automation.** Rejected for a Node.js script
  (`scripts/post-merge-prd.mjs`) — the second post-merge behavior amortizes it
  and the runtime dogfood is part of the product story.
- **Nested sub-issues in Linear.** Rejected: flat + blocked-by is simpler and
  more portable.
- **PRD canonical in Linear, mirrored to git.** Rejected: git is the durable,
  diffable, PR-reviewable source of truth.

---

## Where to reconcile first

Every **⚠ Drifted** row is a place where code and intent actively disagree — the
highest-value foundation work, because both the doc and the code mislead until
reconciled. In rough dependency order:

1. **Run-vs-issue identity (§1).** Persistence and dispatch collapse Workflow Run
   into issue identity. This is the keystone — most of §1's promised payoff and
   the tracker-as-adapter story depend on closing it.
2. **Live-state projection vs mutable SQLite write (§4).** The parallel
   `updateAttempt()` write is exactly the divergence the event-sourcing decision
   exists to prevent.
3. **Default-local plane boundary + control-plane secret resolution (§6).** The
   network seam exists but is off by default, and secrets resolve on the wrong
   plane — the promised security posture is not yet in force.
4. **Gate/hook engines and the intra-state role DAG (§2), artifact validators
   (§3), built-in definitions (§5).** These are _Not delivered_ (honest targets)
   rather than drifted, but they are the bulk of the runtime architecture and
   currently exist only as labels and strings.

## Consolidated status summary

- **§7 (planning pipeline)** is the only fully-grounded decision — built and, for
  the most part, dogfooded.
- **§1–§6 (runtime architecture)** are largely **target architecture**: the
  vocabulary, types, and seams exist, but the load-bearing behavior (run identity,
  log-as-source-of-truth, role DAG, artifact validation, built-in definitions,
  network-default plane split) is either drifted or not yet built.
- The decisions themselves still hold. This document's job is to make sure no
  future reader mistakes the **intent** for the **as-built** — read the status
  table, trust the receipts, and update the row in the same commit that changes
  the behavior.
