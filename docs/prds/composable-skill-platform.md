---
slug: composable-skill-platform
linear_project: https://linear.app/ninetech/project/composable-skill-platform-PENDING
synced_at: 2026-06-02T00:00:00Z
source: docs/roadmap.md#composable-skill-platform
status: draft
---

## Problem Statement

The workflow-first AFK MVP landed the load-bearing core of a multi-agent engine: a typed role DAG with
topological ordering and cycle detection (`src/workflow-definition/registry.ts`,
`src/workflow-run/executor.ts`), versioned Zod-validated artifact contracts checked at production time
(`src/workflow-run/artifact-contracts.ts`), filesystem artifact handoff via the D1 deposit/read-back
protocol (`src/workflow-run/agent-role-prompt.ts`, `run-role-runner.ts`), state-boundary gates with retry
budgets, a parallel verifier council with consensus synthesis (`src/workflow-run/verifier.ts`), and
human-in-the-loop operator approval. A capability assessment confirmed all of this is operational.

But the engine is still a **single hardcoded pipeline**. Four concrete gaps keep it from being a
composable, skill-based platform, and each is a connection-or-extension on an existing seam rather than new
architecture:

1. **The self-improvement loop is open.** `src/workflow-run/memory-store.ts` writes a per-attempt memory
   record and exposes `readPriorAttemptMemory()` (line 130) — but nothing reads it back, and the recorded
   `summary` is the useless string `"Workflow Run <id> completed with status: <status>"`
   (`drive-accepted-run.ts:269`). Attempts cannot learn from prior failures because (a) the attempt number
   is hardcoded to `1`, so attempts never accumulate, and (b) no prior context is ever injected into a
   role prompt. The verifier can already loop a run back to the implementer state on `not_satisfied`
   (`executor.ts:267`), so it re-runs implementation with **zero memory of why the last pass failed**.

2. **There is no runtime skill primitive.** A role is a fixed built-in ID
   (`BUILTIN_ROLE_IDS`, `registry.ts:59`) whose guidance is a static map (`agent-role-prompt.ts:37`) and
   whose tools/permissions are bound implicitly by the dispatcher, not declared. There is no way to
   package `{ instructions, tools, permissions, model }` into a reusable, versioned skill that a pipeline
   references by ID — which is the prerequisite for composing interview, security-review, or research
   skills into workflows without code changes.

3. **Every intent runs the same PR-producing pipeline.** Intake routing
   (`src/workflow-run/intake-rules.ts`) selects a definition by label/state only; nothing reads the
   request to distinguish a question from a development task, and the single shipped definition
   (`.risoluto/workflows/single-operator-afk-coder.yaml`) always ends in `publish-pr`. There is no
   answer-only path: a discussion or question cannot be served without fabricating a PR.

4. **Roles cannot run in parallel within a run.** The executor walks roles in a strictly linear `while`
   loop (`executor.ts:84`) even when the DAG marks them independent. The only multi-agent fan-out is the
   verifier council, hardcoded inside the verifier role.

The cost of leaving these open is a platform that demos as multi-agent but, in practice, runs one
sequential pipeline that forgets everything between attempts and can only ever open a PR. The fix is to
extend the existing typed-registry and artifact-contract patterns — the same templates used everywhere in
the tree — to close the memory loop, introduce a skill primitive, add a classifier and an answer-only
definition, and generalize the council's parallelism into the executor.

## Solution

Four ordered deliverables, each built on the existing typed registry and artifact-contract patterns. The
first is self-contained and ships independently; the rest layer on the contract-extension muscle it
exercises.

- **Deliverable 1 — Close the memory loop (thinnest first).** Make attempts accumulate under a run, write
  a structured `lesson.v1` at run end synthesized from the events and verification/review findings the run
  already produced, persist it in attempt memory, read prior lessons at the start of a later attempt, and
  inject a bounded prior-failure block into each role prompt. The executor and role runner need **zero
  changes** — the loop closes entirely in the memory, prompt, and composition layers.

- **Deliverable 2 — Runtime skill primitive.** Add a typed `BUILTIN_SKILL_IDS` registry alongside
  `BUILTIN_ROLE_IDS`; a skill resolves to `{ promptTemplateId, toolAllowlist, permissionScope,
  modelProfile }`. Add an optional `skillId` to a role; when present, the dispatch resolves the skill,
  drives the session from its prompt template, and passes its tool allowlist and permission scope into the
  agent session. This is the keystone for composing skills into pipelines without code changes.

- **Deliverable 3 — Classifier role + answer-only path.** Add a `classifier` role producing
  `classification.v1` with `type ∈ {question, direct, plan, spec}`, and a `discussion-interviewer.yaml`
  definition whose terminal state omits `publish-pr` — research and respond, no PR. This proves the
  multi-definition claim (today only one YAML exists) and unlocks "ask a question without creating a PR."

- **Deliverable 4 — General intra-pipeline parallelism.** Generalize the verifier council's `Promise.all`
  pattern into level-wise DAG dispatch in the executor so independent roles run concurrently, with the
  verifier retry loop and shared-workspace contention handled explicitly.

All four extend, never replace, the existing contracts. Every new wireable concept (a skill ID, a
classifier role, a `lesson.v1`/`classification.v1` contract) is validated against a typed registry at load
or at production time, so an unknown or malformed reference is a hard failure before a run starts — the
same guarantee the engine already gives for roles, gates, and artifacts.

## User Stories

1. As an AFK operator, I want a retried run to know why its prior attempt failed, so the agent stops
   repeating the same mistake instead of burning budget rediscovering it.
2. As an operator, I want each attempt's lesson derived from the run's own verification and review
   findings, so the learning is grounded in evidence the run actually produced, not a model's guess.
3. As an operator, I want attempts to accumulate under one Workflow Run with real attempt numbers, so the
   memory store has a prior attempt to read at all.
4. As an operator, I want the prior-failure context injected into the role prompt bounded to the last few
   attempts, so the prompt does not grow without limit across many retries.
5. As a maintainer, I want `lesson.v1` to be a registered artifact contract, so it is validated at
   production time and a future reflect agent role can deposit it through the same D1 protocol as every
   other artifact.
6. As a workflow author, I want to package instructions, a tool allowlist, a permission scope, and a model
   profile into a reusable skill referenced by ID, so I can compose a skill into a pipeline without
   editing TypeScript.
7. As a workflow author, I want an unknown `skillId` in a workflow YAML to fail at load, so a typo cannot
   silently fall back to default behavior.
8. As a security-conscious operator, I want a skill's tool allowlist and permission scope enforced on the
   agent session, so a review skill cannot write files and an implement skill's reach is explicit.
9. As an operator, I want a classifier role that labels an intent as question, direct, plan, or spec, so
   the system can route work instead of forcing every intent through one pipeline.
10. As an operator, I want a discussion-interviewer workflow whose terminal state has no publish action, so
    I can ask a question and get a researched answer without a PR being opened.
11. As a maintainer, I want the answer-only routing to reuse the existing handoff `recommendedNextAction` /
    `suggestedSkills` mechanism for its first cut, so it ships without new executor control flow.
12. As an operator, I want independent roles in a workflow to run concurrently, so a multi-perspective
    review does not pay the latency of running each reviewer in series.
13. As a maintainer, I want the verifier retry loop to keep working when roles are levelized, so
    parallelism does not break the existing not_satisfied → retry-implementation behavior.
14. As a maintainer, I want parallel roles that share one git worktree restricted to read-only fan-out (or
    given scratch subdirs) in the first cut, so concurrent writes cannot corrupt the workspace.
15. As a maintainer, I want every new contract and registry entry validated the same way roles, gates, and
    artifacts already are, so the platform's "unknown reference fails loudly" guarantee holds uniformly.

## Implementation Decisions

### Deliverable 1 — Close the memory loop

- **Real attempt numbering is the load-bearing sub-step and ships first.** Today
  `drive-accepted-run.ts:256` hardcodes `attemptId: "attempt-1"` / `attemptNumber: 1`. Thread an
  `attemptNumber` (default `1`) into `DriveAcceptedWorkflowRunInput`, derived at the composition layer by
  counting existing records:
  `(await store.readPriorAttemptMemory({ workflowRunId, beforeAttemptNumber: Number.MAX_SAFE_INTEGER })).length + 1`.
  This does **not** require resolving the ADR §1 run-vs-issue identity drift — attempt memory is already
  keyed on `workflowRunId + attemptId`; only the number is missing.
- **`lesson.v1` is a new artifact contract, registered the existing way.** A new
  `src/workflow-run/lesson-contract.ts` (mirroring `handoff-contract.ts`) defines a strict Zod schema:
  `{ version: 1, workflowRunId, createdAt, attemptNumber, outcome, summary, failureSignals[], correctiveGuidance[] }`.
  Register it by adding `"lesson.v1"` to `WORKFLOW_RUN_ARTIFACT_CONTRACT_IDS`
  (`artifact-contracts.ts:46`) and one entry to the schema table (line 179). That two-line addition makes
  it both YAML-loadable and D1-depositable.
- **The reflect step is deterministic first; a reflect agent role is deferred.** A pure function
  `synthesizeAttemptLesson(...)` in a new `src/workflow-run/attempt-lesson.ts` reads the run's own
  `result.events` (reusing the `blockedOutcome` logic at `drive-accepted-run.ts:154` for gate/budget
  signals) and the produced `verification.v1` / `review.v1` artifacts (for decision and findings) and
  returns a `LessonArtifact`. This honors product principle #9 ("LLMs propose; deterministic orchestration
  disposes"), costs zero tokens, and is unit-testable against fixture events — the structured artifacts
  already contain the findings. A full LLM `reflect` agent role (consuming `verification.v1`/`review.v1`,
  depositing `lesson.v1` via D1) is a purely additive phase-2 enhancement that reuses the same contract.
- **Attempt memory carries the lesson.** Extend `workflowRunAttemptMemoryRecordSchema`
  (`memory-store.ts:19`) and `WriteWorkflowRunAttemptMemoryInput` (line 52) with an optional
  `lesson: lessonArtifactSchema.optional()`. The store already validates on read (line 169), so a
  malformed lesson fails loudly. `writeAttemptMemory` (`drive-accepted-run.ts:256`) takes the attempt
  number, builds `attemptId: \`attempt-${n}\``, synthesizes the lesson, and stores `summary: lesson.summary`
  plus the structured `lesson`.
- **Prior lessons are read at run start and injected into the prompt.** The composition layer
  (`accepted-run-driver.ts:57`, and the parallel `run-start-command.ts` path) reads
  `readPriorAttemptMemory({ workflowRunId, beforeAttemptNumber: attemptNumber })`, maps records to
  `LessonArtifact[]`, and passes them through. `buildAgentRolePrompt` (`agent-role-prompt.ts:4`) gains an
  optional `priorLessons` field and, when present, prepends a bounded "do not repeat these mistakes" block
  capped at the last K=3 attempts. `CreateWorkflowRunAgentDispatchInput` /`AgentRoleDispatchContext`
  (`agent-role-dispatch.ts`) and `resolveDispatchRole` (`run-start-dispatch.ts:62`) thread the field
  through. `executor.ts` and `run-role-runner.ts` are untouched.

### Deliverable 2 — Runtime skill primitive

- **A typed skill registry mirrors the role registry.** A new
  `src/workflow-definition/skill-registry.ts` defines `BUILTIN_SKILL_IDS` and
  `ResolvedSkill = { id, promptTemplateId, toolAllowlist, permissionScope, modelProfile }`, validated with
  the `assertKnownId` style of `registry.ts:238`.
- **A role may reference a skill.** Add optional `skillId` to `roleSchema` (`registry.ts:72`) and
  `ResolvedWorkflowRole` (line 26); assert it against `BUILTIN_SKILL_IDS` in `validateRoleReferences`
  (line 175); resolve it in `resolveWorkflowDefinition` (line 203).
- **The dispatch honors the skill.** When a role carries a `skillId`, `agent-role-dispatch.ts` resolves
  the skill and (a) drives the prompt from its `promptTemplateId` via a new `resolveTemplateById(id)`
  helper alongside `prompt/resolver.ts` (the current resolver keys on issue identifier, not template ID),
  and (b) passes `toolAllowlist` / `permissionScope` into the dispatcher's `runAttempt` call
  (`agent-role-dispatch.ts:51`, which currently passes no tool scoping). The harness/`RunAttemptDispatcher`
  accepting and enforcing a per-session tool allowlist is the genuinely new, highest-risk wiring in this
  PRD and is called out as such.
- **External skill loading is explicitly out of scope** (principle #11, "no external plugin API in v1");
  the in-tree skill registry ships first.

### Deliverable 3 — Classifier role + answer-only path

- **`classification.v1` is a new registered contract.** A new
  `src/workflow-run/classification-contract.ts` defines `{ ...metadata, type: enum(question, direct, plan,
  spec), rationale }`, registered in `artifact-contracts.ts` with the same two-line add as `lesson.v1`.
- **`classifier` is a new built-in role.** Add `"classifier"` to `BUILTIN_ROLE_IDS` (`registry.ts:59`),
  with a `ROLE_GUIDANCE` entry and a `CONTRACT_DATA_SHAPES` entry for `classification.v1`
  (`agent-role-prompt.ts:14`/`37`).
- **An answer-only pipeline is a definition that omits `publish-pr`.** A new
  `.risoluto/workflows/discussion-interviewer.yaml` runs `classify → respond` where the `respond` state's
  `actions:` list contains no `publish-pr`. Answer-only is literally the absence of the publish action.
- **First-cut routing reuses the handoff, not new control flow.** A `classify`-only run whose
  `handoff.recommendedNextAction` / `suggestedSkills` (the `drive-done-handoff.ts` mechanism) names the
  definition to launch next. Dynamic in-engine branching on `classification.v1.type` is a deliberate
  follow-up, since the executor is currently a linear walk over ordered roles (`executor.ts:84`).

### Deliverable 4 — General intra-pipeline parallelism

- **Level-wise dispatch generalizes the council pattern.** Replace the linear `while`
  (`executor.ts:84-119`) with dependency-level grouping: roles whose `dependsOn` is satisfied form a level,
  dispatched with `await Promise.all(level.map(runOrderedRole))` — the exact `Promise.all` shape of
  `verifier.ts:runCouncilVerifier`. A `levelizeRoles` helper sits beside `orderRoles`
  (`executor-roles.ts:11`), which already topo-sorts.
- **The verifier control loop stays correct.** The `verification.v1` retry-to-implementer jump
  (`executor.ts:93-104,267-290`) assumes a linear index. Levels containing the verifier stay sequential in
  the first cut; only independent producing roles (e.g. multiple reviewers) parallelize.
- **Workspace contention is bounded.** Parallel roles share one git worktree
  (`workspace-preparer.ts`); the first cut restricts concurrency to read-only fan-out roles (reviewers over
  the same `change_summary.v1`) or gives each a scratch subdir. Aggregation reuses the council's
  `synthesize` shape.

### Cross-cutting

- All work respects the ESLint ceilings (complexity ≤ 15, file/function size). New synthesis and
  levelizing logic is split into small helpers rather than growing one function.
- No new runtime dependency is introduced; Zod, the archive, and the dispatcher are already present.
- Every status claim that changes runtime behavior updates the matching ADR row in the same commit
  (`docs/adr/0001-foundation.md` §2/§3), per the doc's own contract.

## Testing Decisions

- Tests validate external behavior and contracts, not private implementation. Prior art: the
  `run-start-*.integration.test.ts` family (drive a CLI command with an injected boundary, then assert
  archived artifacts and events) and `tests/workflow-run/memory-store.test.ts`.
- **Deliverable 1.** Unit-test `synthesizeAttemptLesson` against fixture `events` plus a `verification.v1:
  not_satisfied` artifact, asserting the derived `failureSignals` and `correctiveGuidance`; extend the
  memory-store test for the `lesson` round-trip; add an `artifact-contracts` accept/reject test for
  `lesson.v1`. Extend `tests/cli/run-start-evidence-memory.integration.test.ts`: drive attempt 1 to a
  blocked outcome and assert a `lesson.v1`-bearing memory record; drive attempt 2 with an injected
  `dispatchRole` fake that captures the prompt, and assert the prompt contains the prior-attempt block.
- **Deliverable 2.** Registry tests for unknown-skill-ID rejection (copy the unknown-role test); a dispatch
  test asserting the resolved `toolAllowlist` reaches `runAttempt`; an end-to-end YAML referencing a
  skill-bearing role that resolves clean.
- **Deliverable 3.** A registry test loading `discussion-interviewer.yaml` clean; a `classification.v1`
  accept/reject test; an integration test driving the interviewer definition that asserts **no**
  `publish_result.v1` artifact is produced and the handoff is answer-shaped.
- **Deliverable 4.** A unit test for `levelizeRoles` over a diamond DAG; an executor test with two
  independent roles asserting both run (an injected `runRole` records concurrency) and both artifacts are
  stored; a regression test that the verifier retry loop still blocks and retries correctly under
  levelized dispatch.
- The full v1 gate (`build → lint → format:check → test → typecheck → typecheck:coverage`, the `/v1-check`
  skill) is green before each deliverable's PR, and type-coverage stays ≥ 95%.

## Out of Scope

- **Externally-loaded skills** (e.g. a `grill-me` skill fetched from a GitHub repo). Principle #11 defers
  any external plugin API in v1; only the in-tree skill registry ships here.
- **Resolving the ADR §1 run-vs-issue identity drift.** Deliverable 1 adds real attempt numbering keyed on
  `workflowRunId + attemptId`; it does not unify run and issue identity across persistence/dispatch.
- **Dynamic in-engine routing on `classification.v1.type`.** The first-cut classifier routes via the
  handoff mechanism; executor-level conditional branching is a follow-up.
- **Parallelizing the verifier/review level or write-capable roles.** The first parallelism cut covers
  read-only fan-out only.
- **A full LLM `reflect` agent role.** Deliverable 1 ships the deterministic synthesizer; the agent role is
  an additive enhancement on the same `lesson.v1` contract.
- **Run Memory and Project Memory tiers** beyond the attempt tier (the product-spine memory tiers remain
  defined-only here).
- **TUI / HTTP / frontend surfaces, Memory Manager retrieval, and Board Projection** — unrelated.

## Further Notes

- **Build order is the deliverable order, with #1 and #3 parallelizable.** Deliverable 1 is self-contained
  and unblocks the "agents learn across attempts" story — build it first, in its sub-step order (real
  attempt numbering → `lesson.v1` contract → synthesizer → memory persistence → read-at-start → prompt
  injection → composition wiring). Deliverable 3 is independent and cheap, a good parallel track that also
  proves the multi-YAML claim. Deliverable 2 is the keystone but highest-risk (harness tool-scoping); land
  1 and 3 to exercise the contract-extension muscle before it. Deliverable 4 is last — it touches the
  executor's core loop and interacts with the verifier control flow.
- **The typed registry and artifact-contract validation are the templates for every addition here.** No
  step invents a new extension mechanism; each adds an entry to an existing registry or contract table and
  inherits its "unknown/malformed reference fails loudly" guarantee.
- **Pipeline provenance.** This PRD was drafted directly from a capability assessment rather than promoted
  from a `next` roadmap row. Per the research-to-shipping pipeline, add a `composable-skill-platform`
  roadmap row (`docs/roadmap.md`) and run `/risoluto-to-prd composable-skill-platform` to assign the Linear
  Project URL (the `linear_project` frontmatter is a `PENDING` placeholder until that first sync). Each
  deliverable then breaks into flat Linear issues via `/risoluto-to-issues` with `from:prd-composable-skill-platform`
  labels and blocked-by relations (Deliverable 1's attempt-numbering sub-step blocks the rest of #1; #2/#3
  block on the contract-extension pattern landing in #1).
- The Linear Project mirror for this PRD is generated from git. Git remains the canonical PRD source.
