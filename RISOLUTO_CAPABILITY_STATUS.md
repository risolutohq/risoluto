# Risoluto — Current Capability Status

**Scope:** multi-agent pipelines · skill composition · task classification · DAG orchestration
**Date:** 2026-06-02
**Method:** synthesis of `docs/product-spine.md`, `docs/technical-spine.md`, `docs/adr/0001-foundation.md`, `docs/prds/verification-ladder.md`, and direct reading of `src/workflow-run/`, `src/workflow-definition/`, `src/orchestrator/`, `src/prompt/`, plus `.risoluto/workflows/single-operator-afk-coder.yaml`.

> ⚠️ **Doc-vs-code caveat (read first).** The ADR status tables were verified against source on **2026-05-29** and mark the intra-state role DAG (§2), artifact validators (§3), and built-in YAML definitions (§5) as *Not delivered / labels-and-strings*. **The code has since moved past that snapshot.** As of the current tree these are real and load-bearing — `src/workflow-definition/registry.ts`, `src/workflow-run/executor.ts`, `src/workflow-run/artifact-contracts.ts`, and the `single-operator-afk-coder.yaml` definition all exist and execute. Treat the ADR prose as **intent**, this report as **as-built**, and budget a docs-reconciliation pass (update ADR §2/§3/§5 rows) as a side effect of any work here.

---

## 1. Task Classification & Routing

**Current state**
- **Routing exists, but only structurally — not semantically.** `src/workflow-run/intake-rules.ts` selects a workflow definition and workspace from `requiredLabels`, issue `states`, and `provider`, via `workflowLabels` (label→workflowId) and `workspaceLabels` maps. Ambiguous/zero matches throw (`AmbiguousWorkflowRunIntakeError` / `InvalidWorkflowRunIntakeError`).
- **No content classifier.** Issue title/body are passed through opaquely. Nothing reads the text to decide "question vs development task." `intake-core.ts` does delivery/external-object dedup and a `retry` vs `start` decision (`hasRetrySignal` on labels/comments), nothing more.
- **One workflow definition exists** — `DEFAULT_WORKFLOW_DEFINITION_ID = "single-operator-afk-coder"`. Every intent that doesn't match a custom label rule lands in the same 5-role, PR-producing pipeline.
- The vocabulary is *aspirational here*: the product spine lists `classify` as the first Workflow State, but the shipped YAML starts at `plan` — **there is no `classify` state or interviewer/answer-only path anywhere in the runtime.**
- Within-run clarification *does* exist (`operator-response-contract.ts`, Slack questions, verifier `wait_for_operator`) but that is mid-pipeline human-in-the-loop, not an alternate "answer-only, no-PR" route.

**Gap analysis**
- No classifier agent/role; no `classify` state in any definition; no "question/discussion → answer-only, no code, no PR" workflow; no `type ∈ {question, direct, plan, spec}` concept.

**Effort & approach — LOW–MEDIUM**
- The primitives are all present. Add a `classifier` to `BUILTIN_ROLE_IDS` (`registry.ts:59`) producing a new `classification.v1` artifact contract (Zod schema in `artifact-contracts.ts`) with a `type` enum.
- Author a second YAML (e.g. `discussion-interviewer.yaml`) whose terminal state is a `notify-operator` hook / comment-back action and **no `publish-pr` action** — an answer-only path is just a definition with no publish action.
- Routing the classifier's output to a definition is the only genuinely new wiring: today definition selection happens at *intake* (pre-run) from labels, whereas a content classifier runs *inside* a run. Cheapest first cut: a `classify`-only mini-run whose handoff `recommendedNextAction`/`suggestedSkills` tells the operator (or a follow-up intake) which definition to launch — reuses the existing handoff mechanism with zero new control flow.

---

## 2. Multi-Agent Orchestration & Pipelines

**Current state — this is the strongest area.**
- **A typed role DAG for a single run is fully implemented.** `registry.ts` parses YAML roles with `consumes` / `produces` / `dependsOn`, validates the graph (duplicate-id and unknown-dependency checks, `validateRoleGraph`), and `executor.ts:76` `orderRoles()` topologically sorts with cycle detection.
- **Output of one role feeds the next via typed artifacts.** `executor.ts:134-139`: each role runs with `pickArtifacts(state.artifacts, role.consumes)` and `storeProducedArtifacts` validates+stores its `produces`. `assertRequiredArtifacts` (`executor-roles.ts`) hard-fails a role whose input artifact is absent — so a phase literally cannot start until upstream outputs exist.
- **Real "phases."** The shipped pipeline is `plan (planner) → implement (implementer) → review (reviewer → verifier) → publish (ci_babysitter)`, each an outer Workflow State with its own `gates` and `hooks`. State-entry hooks fire on transition (`fireHooksForNewState`), gates evaluate at state boundaries with a retry budget (`evaluateStateGatesWithRetry`).
- **Control loop / conditional re-entry exists.** When `verification.v1` is `not_satisfied` with budget remaining, the executor loops `index` back to the implementer's state start (`resolveVerifierStep` → `retry_implementation`, `executor.ts:267-290`). Decisions also route to `wait_for_operator` / `block`.
- **Human-in-the-loop between stages is built:** `operator-approval-contract.ts`, `slack-operator-approval.ts`, `operator_approval.v1` / `consumed_approval_nonce.v1` artifacts, and the `waiting_for_operator` run status.

**Gap analysis**
- Roles within a state run **sequentially**, even when independent (`while (index < orderedRoles.length)`); the DAG is honored for *ordering*, not *parallelism* (see §5).
- Only one definition is authored — the *engine* is multi-pipeline-capable; the *library* is a single pipeline.
- "Stages with explicit operator approval gates between them" is expressible (a gate that requires `operator_approval.v1`) but not yet authored as a built-in gate type beyond the verifier's `wait_for_operator` route.

**Effort & approach — LOW** (for new sequential pipelines) — the engine already does this; new pipelines are YAML + any new built-in role/gate/contract IDs.

---

## 3. Skill System

**Current state**
- **Two distinct, unconnected "skill" notions exist:**
  1. **Dev-time authoring skills** (`skills/risoluto-*`, `SKILL.md`) — the research-to-shipping pipeline (researcher, grill, ingest, to-prd, to-issues, tdd, goal-run…). These are Claude Code operator tooling, *not* runtime-composable.
  2. **Runtime prompt templates** (`src/prompt/`) — SQLite-backed (`store.ts`), 4-level resolution (`resolver.ts`: per-issue override → system-selected → `default` → empty), strict-Liquid validated (`template-policy.ts`, `strictVariables`/`strictFilters`, no arbitrary filters). This is the legacy *issue-orchestrator* prompt path.
- **Runtime role prompts** are a *third* path: `agent-role-prompt.ts` holds a static `ROLE_GUIDANCE` map (planner/implementer/reviewer/verifier/ci_babysitter) plus a hardcoded deposit protocol telling the agent where to write artifact JSON.

**Gap analysis**
- **No runtime "skill" primitive** = a versioned, composable bundle of *(instructions + tools + permissions)* that a pipeline references by ID. The spine names "**Versioned skill packs**" (technical-spine surface #16, principle #14) but they are explicitly "live in the main repo first" and **not built as a runtime composition layer**.
- Tools/permissions are bound per *agent session by the dispatcher*, not declared per role; there is no per-role tool/permission scoping.
- No template versioning; no external skill loading (e.g. from a GitHub repo like `grill-me`).

**Effort & approach — MEDIUM–HIGH**
- A real skill pack = a registered ID resolving to `{ promptTemplateId, toolAllowlist, permissionScope, modelProfile, consumes/produces }`. The registry pattern in `registry.ts` (typed-ID validation against built-in sets) is the right host; add a `BUILTIN_SKILL_IDS` set + a `skillId` field on a role, resolved at load.
- Externally-loaded skills (post-v1 by principle #11 — "no external plugin API in v1") would be **HIGH**: needs a fetch/verify/sandbox boundary the architecture deliberately defers.

---

## 4. Artifact Handoff & Filesystem Coordination

**Current state — well-developed.**
- **Persistent per-run workspace:** `workspace-preparer.ts` creates a git worktree (or directory) per run on a templated branch; it persists across attempts (`workspaceManager.prepareForAttempt` / before/after-run hooks).
- **Filesystem artifact handoff is the real substrate.** Agents are instructed (`agent-role-prompt.ts`) to deposit `{ "contractId", "data" }` JSON at `…/workflow-runs/{id}/artifacts/{artifactId}.json`; `run-role-runner.ts` reads them back and validates (`readBackProducedArtifact` → throws `WorkflowRunRoleDispatchError` on missing/invalid). So one role *writes a plan/spec file*, the next *reads it* — exactly the convention the question asks about.
- **Production-time validation** (`archive.writeWorkflowRunArtifact` parses through the contract registry before writing) means failures attribute to the producer.
- **Separate raw evidence store** (`evidence-store.ts`, `evidence/raw/`, field classification + redaction) sits alongside contract artifacts.
- **Phase-readiness enforcement already exists:** `assertRequiredArtifacts` + state-boundary gates mean phase N+1 cannot begin until phase N's declared `produces` exist and validate. Hooks fire on state entry (`fireStateEntryHooks`).

**Gap analysis**
- Codex JSONL raw-evidence capture is "not wired yet" (per ADR §3, still accurate).
- Artifacts flow through an **in-memory map** in the executor *as well as* the filesystem; the canonical source-of-truth split (event-log projection vs SQLite mutable write) remains the ADR §4 drift.

**Effort & approach — LOW** — the handoff + readiness-gating you describe is essentially already built; "plan file / spec doc one agent creates and another reads" is the running design.

---

## 5. Parallel / Fan-out Agents

**Current state**
- **Cross-run parallelism: IMPLEMENTED.** `orchestrator/worker-launcher.ts` launches multiple workers concurrently up to `maxConcurrentAgents` / `maxConcurrentAgentsByState`.
- **Verifier council: IMPLEMENTED.** `verifier.ts:runCouncilVerifier` runs N councillors via `Promise.all`, then `synthesize` aggregates into a `verification.v1` with `consensus ∈ {unanimous, majority, split}` (`councilConsensusFor`). This is genuine fan-out + aggregation of multiple agents' findings — exactly the "review from multiple perspectives" pattern.
- **Intra-run role parallelism: ABSENT.** Even though the review state lists reviewer + verifier, the executor runs roles strictly sequentially.

**Gap analysis**
- The only multi-perspective aggregation today is the verifier council; there's no general "fan out K reviewers over the same change_summary and merge findings" outside that role.
- Independent DAG nodes aren't dispatched concurrently.

**Effort & approach — MEDIUM**
- Generalize the council's `Promise.all` + synthesize pattern into the executor: group `orderedRoles` into levels whose `dependsOn` is satisfied, dispatch a level with `Promise.all`. The contract/validation machinery already tolerates this; the main risk is shared-worktree write contention (mitigate with per-role scratch dirs or read-only fan-out roles).

---

## 6. Self-Improvement / Session Learning

**Current state**
- **Attempt Memory: PARTIAL.** `memory-store.ts` writes a per-attempt record (`summary` + `evidenceRefs`) under `…/memory/attempts/`; `readPriorAttemptMemory()` (filters `attemptNumber <` current) exists **but is not wired into the retry path** — retries don't yet consume prior lessons.
- **Self-review: PARTIAL.** `agent-runner/self-review.ts` invokes Codex `ReviewStart`, classifies the summary (pass/fail/neutral), and emits a `self_review` lifecycle event — **logged only**; no correction extraction, no memory write, no retry trigger.
- **Reflection / lesson extraction: ABSENT.** No post-run analyzer turns failures into reusable patterns; `thread-compact.ts` exists but isn't in the lifecycle.

**Gap analysis**
- The *storage* (attempt memory + evidence refs) and the *trigger points* (handoff on done/blocked) exist; the **closing of the loop** does not. Run Memory and Project Memory tiers (product spine) are defined-only.

**Effort & approach — LOW (simplest reflection step)**
- Add a `reflect` role/hook at run end: read the attempt's events + `verification.v1`/`review.v1` findings, write a `lesson.v1` artifact into attempt memory. Then wire `readPriorAttemptMemory()` into `agent-role-prompt.ts` so the next attempt's prompt includes "prior attempt failed because…". Every input (event log, memory store, prompt builder) already exists — this is connection work, not new infrastructure.

---

## 7. Comparison with Turbo

Turbo's model = *pipelines as ordered skill invocations with typed artifact handoff*. Mapping:

| Turbo concept | Risoluto today | Verdict |
|---|---|---|
| Pipeline = ordered steps | YAML state machine + role DAG (`registry.ts`, `executor.ts`) | **Already present** |
| Typed artifact handoff between steps | `artifact-contracts.ts` (Zod, versioned `.v1`), produce-time validation, filesystem deposit + read-back | **Already present** |
| Steps gated on prior outputs | `assertRequiredArtifacts` + state gates + budget retry | **Already present** |
| Conditional branching / loops | Verifier `retry_implementation` / `wait_for_operator` / `block` | **Partially present** (one hardcoded loop, not general edges) |
| Skill = reusable (instructions+tools+perms) invoked in a step | **No runtime skill primitive**; roles are fixed IDs + static guidance | **Largest gap** |
| Parallel fan-out within a pipeline | Verifier council only; executor is sequential | **Partial** |
| Dynamic step selection from classification | None (single definition, label-only routing) | **Gap** |

- **Already partially present:** the DAG engine, typed handoff, and gating — Turbo's structural core is arguably *more* rigorously typed in Risoluto (runtime Zod validation at production time).
- **Most significant code changes:** (1) a **runtime skill abstraction** (instructions+tools+permissions bundle resolved by the registry) — this is the biggest conceptual addition; (2) **content-classification-driven dynamic pipeline selection**; (3) **general intra-pipeline parallelism**.

---

## Readiness Score

# **7 / 10**

**Why it's high:** the load-bearing, hard-to-retrofit pieces of a multi-agent skill-based DAG pipeline are **already built and executing** — a typed role DAG with topological ordering and cycle detection, versioned Zod-validated artifact contracts with producer-time validation, filesystem artifact handoff with read-back, state-boundary gates with retry budgets, a parallel verifier council with consensus, durable per-attempt memory + evidence stores, persistent git-worktree workspaces, and human-in-the-loop approval. A new *sequential* pipeline is a YAML file away.

**Why it's not higher:** four real gaps stand between "here" and "full Turbo-style platform" — (1) no runtime **skill** primitive (tools/permissions aren't role-scoped or composable); (2) no **content classifier** / dynamic pipeline selection (one definition, label-only routing, no `classify` state, no answer-only path); (3) intra-pipeline **parallelism** is limited to the verifier council; (4) the **self-improvement loop is open** (memory is written but never read back into retries). None are architecturally blocked — they're connection-and-extension work on existing seams — but they're the substance of the feature.

---

## Top 5 to build first (ordered)

1. **Close the memory loop (LOW, §6).** Wire `readPriorAttemptMemory()` into `agent-role-prompt.ts` + add a run-end `reflect` hook writing `lesson.v1`. Highest value-per-effort; everything already exists.
2. **Add a `classifier` role + `classification.v1` contract, and an answer-only YAML definition (LOW–MEDIUM, §1).** Unlocks "question vs dev task" and the no-PR interviewer path — a definition with no `publish-pr` action.
3. **Runtime skill primitive (MEDIUM–HIGH, §3).** `BUILTIN_SKILL_IDS` + a `skillId` field on roles resolving to `{promptTemplateId, toolAllowlist, permissionScope, modelProfile}` via the existing typed registry. This is the keystone for Turbo-parity skill composition.
4. **General intra-pipeline parallelism (MEDIUM, §5).** Generalize the council's `Promise.all`+synthesize into level-wise DAG dispatch in `executor.ts`; reuse for multi-perspective reviewer fan-out.
5. **Reconcile the ADR status tables (LOW, doc-debt).** Update §2/§3/§5 rows from "Not delivered" to "Delivered/Partial" with the new `registry.ts`/`executor.ts`/`artifact-contracts.ts` receipts, so the next agent doesn't build on a false "not built" claim. (Per AGENTS.md: a stale doc is worse than no doc.)
