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

Status verified against source on **2026-06-03**. If you change behavior, update
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

| Claim                                                                        | Status        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow Run is a named, durable primitive with its own records and archive  | Delivered     | `src/workflow-run/` (archive keyed on `workflowRunId`)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A run can have multiple Run Attempts                                         | Delivered     | `workflow-run/run-handle.ts:88-91` (interface) / `:221` (impl) define `startRunAttempt` / `completeRunAttempt` / `failRunAttempt` / `cancelRunAttempt`; projection in `run-attempt-projection.ts`                                                                                                                                                                                                                                                                                          |
| Attempt reasons cover retry and resume                                       | Delivered     | enum `"initial" \| "retry" \| "resume"` (`workflow-run/contracts.ts:103`)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| All persistence / dispatch / scheduling / observability key off run identity | ⚠ Drifted     | SQLite tables key on `attempt_id` / `issue_id`; **no `workflow_run_id` column** (`persistence/sqlite/schema.ts:17-81`); dispatch falls back to `issue.id` (`dispatch/server.ts:55`)                                                                                                                                                                                                                                                                                                        |
| Tracker items map to runs via a mapping table, not PK identity               | Partial       | Workflow Run intake now claims provider/external-object mappings before side effects (`workflow-run/intake-idempotency-store.ts`); older orchestrator paths still carry issue-id coupling                                                                                                                                                                                                                                                                                                  |
| Workflow Definitions are reusable templates expressed as state machines      | Partial       | A real `WorkflowDefinition` now exists — `z.infer<typeof workflowDefinitionSchema>` carrying `states[]` of `{ id, roles, gates, hooks }` (`workflow-definition/registry.ts:106`, schema at `:92-103`), YAML-loaded and run via `executeWorkflowDefinition` (`workflow-run/executor.ts:72`). The old `{ config, promptTemplate }` bag is now `WorkflowRuntimeConfig` (`core/types.ts:98`); the outer `StateMachine` (`state/machine.ts:129`) still models Linear issue states, not run flow |
| "Fanout" attempts                                                            | Not delivered | "fanout" is absent from the attempt-reason enum                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

| Claim                                                     | Status    | Evidence                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A working state machine of named stages exists            | Partial   | `StateMachine` is real (`state/machine.ts:129`) but models **Linear issue states** (board columns), not workflow-run lifecycle                                                                                                                                                                                                               |
| Outer transitions are enforced                            | Delivered | `canTransition` (`state/machine.ts:155`) / `assertTransition` (`state/machine.ts:162`), `assertWorkflowStateTransition` (`state/topology.ts:64`), `http/transition-handler.ts:21`                                                                                                                                                            |
| Transition / gate / hook events are recorded              | Delivered | `recordTransition` on `WorkflowRun` writes `validation_gate.evaluated` / `workflow_transition.applied` / `workflow_hook.fired` (`workflow-run/run-handle.ts:209-217`)                                                                                                                                                                        |
| Inside each state, Role Execution is a typed DAG of roles | Partial   | `ResolvedWorkflowRole.dependsOn` (`workflow-definition/registry.ts:32`) + topological `orderRoles` (`workflow-run/executor-roles.ts:11-22`), called from `executor.ts:76`. No `RoleNode` type, and the DAG spans the whole definition rather than per-state. `dag_node` remains only a hook-timing string (`workflow-run/contracts.ts:113`)  |
| Validation Gates evaluate conditions                      | Partial   | `evaluateBuiltInGate` (`workflow-run/gate-hook-engine.ts:135`) evaluates `artifacts-valid` / `validation-passed` / `verifier-satisfied` / `budget-available` against real conditions; the CLI also still accepts a caller-supplied pass/fail (`workflow-run-command.ts:249`). The gate label `{ name, status }` is now at `contracts.ts:106` |
| Hooks fire autonomously at entry / exit / DAG node        | Partial   | `fireStateEntryHooks` (`workflow-run/gate-hook-engine.ts:91`) fires `state_entry` hooks autonomously during execution (`executor.ts:223`); the CLI can also supply hook timings manually (`workflow-run-command.ts:256-259`). No `state_exit` / `dag_node` fire paths exist yet                                                              |

### Consequences

When the inner DAG lands, outer lifecycle stays legible to operators and tracker
projections while inner role choreography stays expressive. **Cost:** two
structural models to keep coherent. The inner role DAG, the gate engine, and
entry-hook firing now exist in partial form (`workflow-run/executor.ts`,
`executor-roles.ts`, `gate-hook-engine.ts`); what remains is exit / DAG-node hook
firing and making the definition's own state machine — not the issue-state
`StateMachine` — the run-flow driver.

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

| Claim                                                                     | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifacts carry a `contractId` identifier                                 | Delivered | `WorkflowRunArtifactReference.contractId` (`workflow-run/contracts.ts:95`)                                                                                                                                                                                                                                                                                                                                                              |
| A contract is a TS type + runtime validator + meaning                     | Partial   | `workflow-run/artifact-contracts.ts` defines runtime validators for 12 contract IDs (`WORKFLOW_RUN_ARTIFACT_CONTRACT_IDS`, lines 33-46) — `intent.v1`, `plan.v1`, `change_summary.v1`, `review.v1`, plus `validation_result.v1`, `publish_result.v1`, `ci_result.v1`, `verification.v1`, `handoff.v1`, `operator_response.v1`, `operator_approval.v1`, `consumed_approval_nonce.v1`; prose meaning still lives in the PRD / issue slice |
| Contracts are versioned                                                   | Partial   | The upstream contract schemas require `version: 1` and are registered by `.v1` IDs (`workflow-run/artifact-contracts.ts`)                                                                                                                                                                                                                                                                                                               |
| A role declares the contracts it consumes (inputs) and produces (outputs) | Partial   | Workflow Definition YAML declares role consumes/produces contracts (`.risoluto/workflows/single-operator-afk-coder.yaml`); runtime role execution still records one output artifact                                                                                                                                                                                                                                                     |
| Validation happens at production time, not consumption time               | Delivered | `WorkflowRunArchive.writeWorkflowRunArtifact` parses data through the contract registry before writing (`workflow-run/archive.ts`)                                                                                                                                                                                                                                                                                                      |
| Raw harness evidence (Codex JSONL) stored separately                      | Partial   | `workflow-run/evidence-store.ts` stores raw evidence under `evidence/raw/`, separate from contract artifacts; Codex JSONL capture is not wired yet                                                                                                                                                                                                                                                                                      |

### Consequences

When contracts carry validators, cross-role testing becomes real (synthesize a
valid input, run the role, validate the output) and replay / Memory Builder get
structured surfaces. **Cost:** contract drift becomes a thing to manage. Validators
now exist for the 12 contract IDs, but the full testing / replay payoff is still
partial: a role's consumes / produces contracts are declared in YAML while runtime
role execution records only one output artifact (§3 table).

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
| Events carry a monotonic sequence                       | Delivered     | `archive.ts:183` computes `Math.max(0, ...sequences) + 1` in `nextWorkflowRunEventSequenceForRunDir`                                                 |
| Live state is a projection, not a separate write        | ⚠ Drifted     | A parallel mutable write exists: SQLite `attempts` rows are updated in place via `updateAttempt()` (`persistence/sqlite/attempt-store-sqlite.ts:78`) |
| Events have typed (discriminated) payloads              | Partial       | `WorkflowRunEventRecord` is one wide all-optional-field bag, and `sequence` is typed optional — not a discriminated union per event type             |
| Retention is per-Workflow-Definition with env overrides | Not delivered | Only a hardcoded 7-day window for cost samples; no per-definition retention                                                                          |
| Redaction strips by classification before export        | Partial       | Evidence display redacts classified fields plus sanitizer matches (`workflow-run/evidence-store.ts`); a full export bundle is not wired yet          |
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

## 5. YAML Config-Authored Workflow Definitions (No User-Authored DSL)

### Context

Risoluto's value depends on Workflow Definitions — the planner → implementer →
reviewer pipeline, the fanout-and-grade pipeline, the spec-first interviewer
pipeline. Operators will want to author and tune their own, and the natural
authoring surface is a config file, not TypeScript. This **reverses the earlier
v1 stance** ("built-in TypeScript records; YAML rejected as a DSL without the
type system"). The type-safety objection is answered below by keeping the YAML
thin and resolving every reference against a typed registry.

### Decision

Workflow Definitions are **config-authored YAML** in `.risoluto/workflows/`, with
**no user-authored programming DSL** — the YAML names typed built-ins, it does not
contain logic. The constraints that keep it safe:

- **Thin wiring, zero behavior.** YAML carries only references to built-in
  roles / hooks / gates / actions / validation profiles / model profiles /
  artifact contracts, the DAG edges between them, and parameter values. No shell,
  no conditionals, no expressions.
- **References resolve against a typed registry at load** — an unknown ID is a
  hard failure before the run starts. `tsc` still owns what each built-in is; the
  YAML only wires them.
- **The schema carries a `version` field from day one**, so it can evolve without
  breaking files already on disk.
- **Branch templates are a fixed token set** (`{workflow}`, `{run-id}`, `{date}`,
  `{short-intent}`), never arbitrary expressions.
- **Config resolution is two levels** — value in the definition, else a global
  default; the per-workspace tier is cut for now. **Resolved values are stamped on
  the run record** so "why did this run use model X?" is readable, not replayed.

### Implementation status

| Claim                                                       | Status    | Evidence                                                                                                                                                                        |
| ----------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No user-authored programming DSL exists                     | Delivered | No DSL parser / loader / authoring surface anywhere in `src/`                                                                                                                   |
| YAML schema + registry + resolver + validator               | Delivered | `workflow-definition/registry.ts` loads strict YAML, resolves defaults, validates built-in references, and rejects unknown fields                                               |
| `single-operator-afk-coder` exists as a YAML definition     | Delivered | `.risoluto/workflows/single-operator-afk-coder.yaml`                                                                                                                            |
| References resolve against a typed registry (unknown fails) | Delivered | `workflow-run-start-command.ts` resolves the requested Workflow Definition before creating a run record; registry tests cover unknown role / command / missing version failures |

> **Build note (updated 2026-06-03).** The workflow-definition subsystem is now
> real: a strict zod schema (`workflow-definition/registry.ts`) with `states[]` of
> `{ id, roles, gates, hooks }`, a loader / resolver / validator, and an executor
> (`workflow-run/executor.ts`). What stays thin is the breadth of built-in
> roles / gates / hooks and the depth of their runtime behavior (see §2) — not the
> authoring surface, which exists and is exercised by `single-operator-afk-coder`.

### Consequences

The authoring surface is the one operators will keep, and the `version` field plus
the thin surface mean the schema can be redesigned because behavior lives in TS,
not YAML. **Cost:** the first schema is shaped by a single workflow
(`single-operator-afk-coder`) — treat it as version 1, not the final shape. The
per-workspace config tier and cross-workspace defaults are deferred until
multi-workspace pain is real.

### Alternatives considered

- **Built-in TypeScript records (the earlier v1 stance).** Reversed: YAML is the
  intended long-term authoring surface, and the type safety is recovered via the
  typed registry rather than the file format.
- **Hybrid — TS definition, YAML only for selection / overrides.** Considered as a
  half-step; full YAML authoring was chosen instead.
- **User-authored programming DSL / shell in YAML.** Rejected: out of scope; the
  line stays at config-authored references to typed built-ins.

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

| Claim                                                      | Status        | Evidence                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dispatcher seam separates the planes                     | Delivered     | `RunAttemptDispatcher` (`dispatch/types.ts:21`); `AgentRunner` (local) + `DispatchClient` (remote)                                                                                                                                        |
| A network-shaped contract (HTTP + SSE) exists              | Delivered     | `dispatch/client.ts:114` (`fetch`; `text/event-stream` header at `:119`); `dispatch/server.ts` `createDataPlaneServer` (Express), launched by `dispatch/entrypoint.ts`                                                                    |
| Control plane owns CLI + HTTP operator surfaces            | Delivered     | `cli/`, `http/server.ts` (full route + OpenAPI surface)                                                                                                                                                                                   |
| The interface is network-shaped by default, not in-process | ⚠ Drifted     | `DISPATCH_MODE` defaults to `"local"` → in-process call (`dispatch/factory.ts:34`, `orchestrator/worker-launcher.ts:536`). Default deployment is a monolith                                                                               |
| Secrets resolve in the execution plane by default          | ⚠ Drifted     | `SecretsStore` is a control-plane singleton; secrets are resolved into `ServiceConfig` via `secretResolver` (`config/store.ts:51`) and shipped to the data plane as the `config` field of the dispatch request (`dispatch/client.ts:106`) |
| Model credentials resolve execution-side                   | Partial       | Read from `process.env` at container spawn (`docker/spawn.ts:93`); execution-side only when `DISPATCH_MODE=remote`                                                                                                                        |
| Control plane owns a TUI                                   | Not delivered | No TUI exists anywhere in the tree (TUI is "next" per AGENTS.md, not built)                                                                                                                                                               |
| Raw evidence locality is policy-controlled                 | Not delivered | No evidence-locality policy / config key exists                                                                                                                                                                                           |

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

> **Update 2026-05-29 (decision [#30](../decisions.md) superseded by two-mode pipeline).** The
> original pipeline used auto-synthesized idea clusters written to `capability-backlog.md` and
> `research/ideas/` — both surfaces are retired. The current model has two research modes feeding
> one founder-owned roadmap:
>
> **Mode A (targeted adoption):** `risoluto-researcher` deep-analyzes a source, writes
> `research/targets/<slug>/README.md`, deduplicates candidates against the roadmap and
> `research/RISOLUTO_FEATURES.md`, and passes survivors to the critic-grill (`risoluto-grill`).
> Kept candidates become roadmap rows the founder ranks.
>
> **Mode B (sense-making / innovation):** `risoluto-ingest` (the reborn synthesizer — retired name:
> `risoluto-synthesizer`) reads all `research/targets/` and builds a connected wiki at
> `research/wiki/`. It then does gap-grounded idea generation — an idea is only emitted if it cites
> the research dots it connects (cite-or-drop); generated ideas land as roadmap rows (status: idea).
>
> Both modes converge on [`docs/roadmap.md`](../roadmap.md) — the single ordered plan, founder-owned.
> Skills may append proposed rows (status: idea); no skill reorders, promotes, or deletes rows.
> The critic-grill challenges fit-vs-spine, differentiation, and thinnest shippable cut; the founder
> decides in/out. The back-half (PRDs canonical in git, flat Linear issues with blocked-by,
> fork-not-upgrade skills, manual `/tdd`) is unchanged. **Skill rewiring has landed.**
> Current flow: [`research-to-shipping-pipeline.md`](../research-to-shipping-pipeline.md).

### Context

The v1 planning surface evolved ad-hoc: research in Obsidian, ideas in a flat
backlog, manual tool-switching from "interesting cluster" to "shipped PR." The
operator needed a repeatable, auditable pipeline. The seam between planning and
runtime is the **Linear ticket**, not the harness.

### Decision

Risoluto ships a five-phase planning pipeline as composable skills + CI
automations:

| Phase | Skill / Automation                           | Artifact                                                                          |
| ----- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| 1     | `risoluto-researcher`, `risoluto-vault`      | `research/targets/<slug>/README.md` + sources                                     |
| 2     | `risoluto-ingest`                            | `research/wiki/` (connected wiki) + gap-grounded roadmap idea-rows (status: idea) |
| 3     | `risoluto-grill` (critic), `risoluto-to-prd` | Roadmap rows (idea/next) + `docs/prds/<slug>.md` + Linear Project                 |
| 4     | `risoluto-to-issues`, `risoluto-tdd`         | Linear Issues + PRs with `from:prd-*` labels                                      |
| 5     | Post-merge workflow                          | PRD `status: shipped` + Linear back-comments                                      |

Key decisions: **PRDs are canonical in git** (Linear descriptions are generated
mirrors; a pre-push hook blocks drift). **Flat issues with blocked-by relations**
(no parent-child nesting). **LLM-inferred slice graphs** (non-deterministic;
operator reviews before issue creation). **Fork-not-upgrade** (Linear-specific
behavior lives in `skills/risoluto-*`; global skills stay generic). **Manual
`/tdd <ticket-ref>`** (runtime auto-pickup deferred behind the `auto:runtime`
label seam).

### Implementation status

| Claim                                                         | Status    | Evidence                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All seven pipeline skills exist as real skill dirs            | Delivered | `skills/risoluto-{researcher,vault,ingest,grill,to-prd,to-issues,tdd}/SKILL.md` (`risoluto-ingest` replaces the retired `risoluto-synthesizer`)                                                                                                                                                    |
| PRDs canonical in git, Linear descriptions mirrored           | Delivered | `docs/prds/README.md`; `risoluto-to-prd/SKILL.md`                                                                                                                                                                                                                                                  |
| A pre-push hook detects PRD drift and blocks the push         | Delivered | `.husky/pre-push` → `prd:drift-check` → `scripts/prd-drift-check.ts` (runs unconditionally; `SKIP_HOOKS` does not bypass it)                                                                                                                                                                       |
| The drift check requires `LINEAR_API_KEY`                     | Delivered | `requireApiKey` defined in `scripts/prd-linear.ts:219` (hard `exit 1` if unset), imported and called from `scripts/prd-drift-check.ts:200`                                                                                                                                                         |
| Flat issues with blocked-by relations, no nesting             | Delivered | `risoluto-to-issues/SKILL.md`                                                                                                                                                                                                                                                                      |
| Post-merge automation flips PRD status + back-comments Linear | Delivered | `scripts/post-merge-prd.mjs`, wired to CI in `.github/workflows/post-merge.yml` (`pull_request: closed`, `merged == true`) — **CI-only, not the local `.husky/post-merge` hook**                                                                                                                   |
| Skills are wired via symlink into `~/.claude/skills`          | Partial   | 19 symlinks in repo-local `.claude/skills/` → `../../skills/risoluto-*`, discovered via project-level skill loading; not symlinked into the user-global `~/.claude/skills/`                                                                                                                        |
| The pipeline has been dogfooded end to end                    | Partial   | Two PRDs exist (`docs/prds/workflow-first-afk-mvp.md`, `docs/prds/verification-ladder.md`); Phase 4 (`to-issues` → `tdd`) has been exercised for `workflow-first-afk-mvp` (issues labelled `from:prd-workflow-first-afk-mvp`, code merged), but a full research→merge cycle (Modes A + B) has not been run end to end |

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
4. **Depth of the role DAG, gate engine, and hook firing (§2).** These now exist
   in partial form — topological `orderRoles`, `evaluateBuiltInGate`, and
   `fireStateEntryHooks` — but only `state_entry` hooks fire, gates also accept a
   caller-supplied pass/fail, and the DAG spans the whole definition rather than
   running per state. The artifact validators (§3) and YAML definitions (§5) are
   built; what remains is wiring role I/O contracts through and broadening the
   built-in role / gate / hook set.

## Consolidated status summary

- **§7 (planning pipeline)** is the most grounded decision — the back-half skills are built and
  the roadmap-centric model is in force, but the two-mode research flow (Modes A + B) has not
  yet been dogfooded end-to-end.
- **§1–§6 (runtime architecture)** are now a mix of built and target: the
  workflow-definition subsystem (schema, registry, executor), the role-DAG
  ordering, the gate and entry-hook engines, and the artifact validators exist in
  partial form. The load-bearing gaps that remain are run-vs-issue identity (§1),
  log-as-source-of-truth vs the mutable SQLite write (§4), and the network-default
  plane split with execution-side secrets (§6).
- The decisions themselves still hold. This document's job is to make sure no
  future reader mistakes the **intent** for the **as-built** — read the status
  table, trust the receipts, and update the row in the same commit that changes
  the behavior.
