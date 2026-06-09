---
slug: workflow-first-afk-mvp
linear_project: https://linear.app/ninetech/project/workflow-first-afk-mvp-f21a3ba5db93
synced_at: 2026-05-31T00:00:00Z
source: docs/roadmap.md#workflow-first-afk-mvp
status: shipped
---

## Problem Statement

Risoluto's foundation names the right product primitive: a Workflow Run, not a tracker issue. The
current shipped surface still leaves the MVP story incomplete because the operator cannot yet define
a complete workflow, start it through several intakes, let it run AFK, and return to a reviewable
result whose evidence, verification, cost, and next action are clear.

The MVP must prove that Risoluto is workflow-first background engineering orchestration. Linear,
GitHub Issues, Slack, CLI, and HTTP are intakes or projections. They must not become the core
identity of the work. The operator's need is a trustworthy single-operator AFK loop: give Risoluto
an engineering intent, let the configured workflow execute in an isolated worktree, have the system
validate and verify the result, publish a draft or ready PR when appropriate, and return with a
compact handoff that explains what happened.

The missing product surface is therefore not a dashboard, a tracker automation script, or a generic
agent runner. It is a complete workflow engine with configurable Workflow Definitions, deterministic
gates, hook/action execution, typed artifacts, verifier semantics, operator approvals, and enough
adapter support to dogfood real code changes end to end.

## Solution

Ship a workflow-first AFK MVP centered on the `single-operator-afk-coder` Workflow Definition. The
definition is authored as **thin** YAML in `.risoluto/workflows/`: it carries no behavior, only
references to registered built-in roles, hooks, gates, actions, validation profiles, model profiles,
and artifact contracts, the DAG edges between them, and parameter values. Every reference resolves
against a typed registry at load — an unknown ID is a hard failure before the run starts — and the
schema carries a `version` field from day one. This gives Omer a config-authored workflow surface
without introducing arbitrary command execution or a full user-authored DSL. (See ADR-0001 §5, which
this PRD updates.)

Every intake normalizes to an `intent.v1` artifact and creates or resumes a Workflow Run. The MVP
supports CLI start, Slack slash command and modal start, first-class experimental HTTP endpoints,
and explicit Linear/GitHub issue intake rules. Tracker issues are external references. Idempotency
is enforced through both webhook delivery dedupe and external object/rule mapping, so webhook and
polling paths cannot create duplicate runs for the same external work item.

The runtime executes the workflow through canonical states, role DAGs, hooks, gates, and transitions.
The initial role pack is `planner`, `implementer`, `reviewer`, `verifier`, and `ci_babysitter`.
Validation, publishing, evidence capture, worktree management, Slack interactions, and CI polling are
actions or adapters, not hidden prompt behavior. Hooks run deterministic side effects and evidence
collection. Gates validate artifacts, budgets, approvals, and mechanical prerequisites. The verifier
or verifier council owns the semantic judgment of whether the final output satisfies the original
intent.

Code-changing workflows always use Git worktree isolation. A run operates on one explicitly
configured workspace, generates a unique branch from a configurable branch template, runs a built-in
validation profile, produces a reviewable result, and publishes according to the configured PR mode:
none, draft, ready, incomplete draft, or auto-merge. Ready PRs require local validation green and
verifier satisfaction. Auto-merge additionally requires green remote CI, a second post-CI verifier
pass, merge policy satisfaction, and Slack approval from an authorized operator.

Slack becomes both an operator channel and an intake surface. The MVP includes secure Slack inbound
verification, slash commands, modals, buttons, operator identity mapping, permission checks,
clarification replies, risky-action approvals, budget override approvals, cancellation, retry, and
handoff delivery. Slack answers and approvals are persisted as typed artifacts and auditable events.

Risoluto stores all structured artifacts and raw evidence locally under the Workflow Run archive with
a redaction policy. It uses Attempt Memory for retries and handoff, and it can propose project memory
candidates from evidence. Approved project memory is local/private by default inside workspace
metadata. Stable repo-wide guidance may be promoted into repo docs only through explicit approval and
a normal PR path.

MVP is complete when a real dogfood run can start from CLI, Slack modal, and at least one automatic
tracker intake rule, execute the same workflow engine, produce validated and verified artifacts, open
a reviewable PR, babysit GitHub Actions when required, interact with Omer through Slack, expose
status through CLI and HTTP, avoid duplicate runs, and pass a full read-only `risoluto doctor` plus
targeted live checks.

## User Stories

1. As a Risoluto operator, I want to start a Workflow Run from the CLI with a workflow, workspace,
   and intent, so that I can prove the core loop without any tracker dependency.
2. As a Risoluto operator, I want to start a Workflow Run from a Slack slash command and modal, so
   that I can launch AFK work from the place I already monitor.
3. As a Risoluto operator, I want Linear issues with explicit labels and states to start workflows
   automatically, so that manually created planning issues can enter the AFK loop without copy/paste.
4. As a Risoluto operator, I want GitHub issues with explicit labels and states to start workflows
   automatically, so that GitHub can be an intake adapter without becoming the core primitive.
5. As a Risoluto operator, I want every intake to produce the same `intent.v1` shape, so that CLI,
   Slack, Linear, and GitHub start the same workflow engine.
6. As a Risoluto operator, I want external tracker issues to be recorded as external references, so
   that Workflow Run identity is not tied to tracker identity.
7. As a Risoluto operator, I want webhook and polling intake to be idempotent, so that duplicate
   deliveries, missed webhooks, and repeated edits do not create duplicate runs.
8. As a Risoluto operator, I want explicit retry labels, comments, Slack buttons, and CLI retry
   commands to create a new Run Attempt under the same Workflow Run, so that retries preserve run
   history.
9. As a Risoluto operator, I want workflow selection by tracker label or intake-rule default, so
   that one tracker can feed several workflows safely.
10. As a Risoluto operator, I want workspace selection by label or intake-rule default, so that
    automatic intake always targets an explicit configured workspace.
11. As a Risoluto operator, I want ambiguous workflow or workspace labels to reject intake with a
    clear comment, so that the system does not guess.
12. As a Risoluto operator, I want a run rejected before creation when intake rules fail, so that bad
    intake does not pollute the Workflow Run archive.
13. As a workflow author, I want Workflow Definitions in YAML under the repo workflow directory, so
    that workflows are versioned, reviewable, and portable.
14. As a workflow author, I want YAML to reference only built-in IDs (roles, hooks, gates, actions,
    profiles, contracts) resolved against a typed registry at load — an unknown ID failing before the
    run starts — rather than shell commands, so that MVP workflows remain deterministic and testable.
15. As a workflow author, I want a versioned, generic Workflow Definition schema (a `version` field
    from day one), so that I can add more workflows later and evolve the schema without breaking files
    already on disk.
16. As a workflow author, I want a registry that loads and validates workflow files, so that invalid
    workflow configuration fails before a run starts.
17. As a workflow author, I want role DAGs in the config, so that future workflows can express
    dependencies even if the MVP executes mostly linear role chains.
18. As a workflow author, I want per-role model profiles, so that planner, implementer, reviewer,
    verifier, and CI babysitter can use different model strengths.
19. As a workflow author, I want definition-level config with a single global-default fallback (two
    levels, no per-workspace tier) and the resolved values recorded on the run, so that configuration
    is simple and every run can explain why it used a given model, budget, or PR mode.
20. As a workflow author, I want configurable budgets for wall-clock time and measured cost (token
    usage × per-model-profile price, checked between steps), so that AFK runs cannot spend without
    bounds.
21. As a workflow author, I want one default LLM retry per failed gate and a configurable override,
    so that recovery is predictable but adaptable for larger work.
22. As a workflow author, I want configurable dirty workspace policy for existing checkouts, so that
    operator-owned changes are never overwritten accidentally.
23. As a Risoluto operator, I want code-changing workflows to always use Git worktrees, so that each
    run has an isolated branch and workspace.
24. As a Risoluto operator, I want branch names to be unique and built from a fixed set of template
    tokens (`{workflow}`, `{run-id}`, `{date}`, `{short-intent}`) rather than arbitrary expressions, so
    that branches are traceable without depending on tracker issue IDs.
25. As a Risoluto operator, I want worktree retention to be configurable with a 7-day default, so
    that blocked and cancelled runs remain inspectable without unbounded disk growth.
26. As a Risoluto operator, I want worktrees with PRs to remain until the PR is merged or closed, so
    that review and follow-up are not disrupted.
27. As a Risoluto operator, I want the planner role to first triage the intent for clarity and size
    (blocking early if it is ambiguous or too large) and then produce a valid `plan.v1`, so that later
    roles have a structured plan and budget is not spent on an under-scoped intent.
28. As a Risoluto operator, I want the implementer role to consume the plan and produce a
    `change_summary.v1`, so that the system can inspect what changed.
29. As a Risoluto operator, I want the reviewer role to produce `review.v1`, so that technical safety
    and code quality are checked separately from intent satisfaction.
30. As a Risoluto operator, I want the verifier role to compare the original intent with the final
    output, so that "tests passed" does not hide incomplete work.
31. As a Risoluto operator, I want the verifier to run before publishing, so that obviously incomplete
    or mismatched changes do not create noisy PRs.
32. As a Risoluto operator, I want the post-publish verifier (ready and auto-merge only) to be a cheap
    incremental re-confirm over the new evidence (CI result, PR state, handoff) — flipping the verdict
    only if that evidence contradicts it, not a second full judgment — so that PR/CI state is included
    without paying the full (possibly council) cost twice. Draft and none get the pre-publish pass only.
33. As a Risoluto operator, I want the verifier isolated to a fixed input allowlist — the original
    `intent.v1`, `plan.v1`, `change_summary.v1`/diff, `review.v1`, validation output, and CI output,
    never the implementer transcript — so that it judges evidence rather than the implementer's narrative.
34. As a Risoluto operator, I want the verifier to support a council mode, so that high-stakes work
    can use multiple perspectives before semantic satisfaction is decided.
35. As a Risoluto operator, I want council disagreement captured as evidence, so that the final
    handoff preserves uncertainty and tradeoffs.
36. As a Risoluto operator, I want diverse councillors (different model profiles and lenses) and a
    synthesizer that always decides semantic satisfaction and tags consensus as `unanimous`/`majority`/`split`,
    so that judgment is not a crude vote threshold and a split is recorded for review rather than hidden.
37. As a Risoluto operator, I want deterministic gates to own mechanical prerequisites, so that a
    verifier cannot declare success when validation, artifacts, approvals, or budget policy failed.
38. As a Risoluto operator, I want `not_satisfied` verification to route back to the implementer when
    retry budget remains, so that the workflow can repair missing requirements.
39. As a Risoluto operator, I want `uncertain` verification to ask Slack first, retry if unanswered and
    budget remains, then block, so that ambiguous outcomes are handled honestly.
40. As a Risoluto operator, I want strict runtime validation for every artifact contract, so that
    gates never depend on unstructured prose.
41. As a Risoluto operator, I want artifact validation failures attributed to the producer, so that
    retries target the right role or action.
42. As a Risoluto operator, I want validation profiles instead of arbitrary workflow commands, so that
    repository checks are configurable and deterministic.
43. As a Risoluto operator, I want validation failure handling to be configurable, so that some runs
    stop fast while others collect broader evidence.
44. As a Risoluto operator, I want LLM retries to receive exact validation failure evidence, so that
    repair attempts are grounded.
45. As a Risoluto operator, I want publish modes for none, draft, ready, incomplete draft, and
    auto-merge, so that different risk levels can be represented.
46. As a Risoluto operator, I want draft PR to be the default, so that MVP output is reviewable
    without pretending it is ready.
47. As a Risoluto operator, I want incomplete work to publish only as an approved draft while the run
    stays blocked, so that useful partial work is visible but not mislabeled as done.
48. As a Risoluto operator, I want ready PRs to require local validation green and verifier
    satisfaction, so that readiness reflects both mechanics and intent.
49. As a Risoluto operator, I want auto-merge to require Slack approval, green CI, post-CI
    verification, and merge policy checks, so that automation does not bypass judgment.
50. As a Risoluto operator, I want a CI/CD adapter contract with GitHub Actions first, so that CI
    babysitting can grow to other providers later.
51. As a Risoluto operator, I want a hybrid CI babysitter, so that deterministic APIs collect status
    and logs while an LLM summarizes cause and routes fixable failures.
52. As a Risoluto operator, I want the CI babysitter required for ready and auto-merge modes, so that
    remote checks are handled actively rather than passively timed out.
53. As a Risoluto operator, I want the CI babysitter to rerun likely flaky checks when allowed, so
    that transient failures do not stop good work unnecessarily.
54. As a Risoluto operator, I want code-caused CI failures to route back to the implementer when
    budget remains, so that the run can repair itself.
55. As a Risoluto operator, I want CI timeouts and unavailable providers to produce structured
    blocked evidence, so that I know exactly what stopped progress.
56. As a Risoluto operator, I want Slack questions to support clarification and approval flows, so
    that AFK execution can safely ask for human input when configured.
57. As a Risoluto operator, I want Slack approvals separated from Slack clarifications, so that risky
    actions have stronger audit semantics.
58. As a Risoluto operator, I want Slack approvals to record operator identity and permission, so that
    approvals are attributable.
59. As a Risoluto operator, I want allowed Slack users mapped to operator identities, so that any
    workspace member cannot approve risky actions.
60. As a Risoluto operator, I want permissions for starting runs, answering clarifications, approving
    PR creation, overriding budget, approving destructive actions, approving secret access, approving
    auto-merge, and cancelling runs, so that controls are explicit.
61. As a Risoluto operator, I want Slack request signing and replay protection, so that inbound
    commands and buttons are secure.
62. As a Risoluto operator, I want Slack modal submissions to create Workflow Runs through the same
    intake pipeline as CLI, so that Slack is not a special execution path.
63. As a Risoluto operator, I want every Slack action to become an event or artifact, so that the
    audit trail is complete.
64. As a Risoluto operator, I want a canonical Run Status axis (operational lifecycle) kept distinct
    from Workflow State (per-definition DAG position), so that run state is consistent across CLI, HTTP,
    Slack, Linear, and GitHub and boards project from Run Status.
65. As a Risoluto operator, I want explicit adapter status mapping tables, so that external boards
    project Workflow Run state without owning it.
66. As a Risoluto operator, I want unmapped adapter statuses to block projection with a clear error,
    so that status drift cannot silently mislead me.
67. As a Risoluto operator, I want CLI commands for start, status, logs, cancel, retry, workflow list,
    workflow validate, and doctor, so that I can operate the system from the terminal.
68. As an API consumer, I want experimental HTTP endpoints for runs, workflows, events, artifacts,
    intake, Slack, webhooks, and doctor, so that external tools can integrate without scraping CLI
    output.
69. As an API consumer, I want bearer-token auth for normal HTTP endpoints, so that the experimental
    API is not open by default.
70. As an adapter author, I want Slack, Linear, and GitHub webhook endpoints to use provider-native
    signature verification, so that integration auth matches provider security models.
71. As a Risoluto operator, I want all raw evidence stored locally with redaction policy, so that
    debuggability does not require remote persistence.
72. As a Risoluto operator, I want structured artifacts and raw evidence stored separately, so that
    gates can use typed records while humans can inspect full context.
73. As a Risoluto operator, I want Attempt Memory for retries and handoff, so that repeated attempts do
    not repeat the same mistakes.
74. As a Risoluto operator, I want project memory candidates proposed from evidence, so that reusable
    lessons can accumulate without becoming automatic prompt pollution.
75. As a Risoluto operator, I want project memory promotion mode configurable, so that trusted
    workspaces can auto-promote low-risk memories while sensitive workspaces require approval.
76. As a Risoluto operator, I want project memory local/private by default, so that operational
    history and Slack metadata are not committed accidentally.
77. As a Risoluto operator, I want repo documentation candidates promoted only by approval and PR, so
    that stable conventions become durable project docs deliberately.
78. As a Risoluto operator, I want raw evidence never committed by default, so that transcripts, logs,
    and API payloads stay out of source control.
79. As a Risoluto operator, I want `handoff.v1` as structured JSON plus rendered Markdown, so that
    machines can validate it and humans can read it quickly.
80. As a Risoluto operator, I want handoff content to reference artifacts and evidence instead of
    copying everything, so that handoffs are compact and source-backed.
81. As a Risoluto operator, I want handoffs to include suggested skills, so that the next agent or
    operator knows how to continue.
82. As a Risoluto operator, I want handoffs to include budget use, validation, PR/branch links, failed
    gate or blocking question, evidence links, and recommended next action, so that return-from-AFK is
    actionable.
83. As a Risoluto operator, I want a full `risoluto doctor`, so that setup failures are found before
    an AFK run starts.
84. As a Risoluto operator, I want doctor to be read-only by default, so that setup validation does
    not mutate providers unexpectedly.
85. As a Risoluto operator, I want `doctor --live` to run explicit write tests, so that I can verify
    end-to-end permissions when I choose.
86. As a Risoluto operator, I want doctor to validate workflow YAML, artifact contracts, actions,
    gates, roles, model profiles, workspaces, Slack, GitHub PRs, CI access, intake rules, status
    mappings, budgets, evidence paths, redaction policy, and idempotency storage, so that MVP readiness
    is observable.
87. As a Risoluto operator, I want the TUI deferred, so that the MVP stays focused on the workflow
    loop while OpenTUI remains the preferred future direction.

## Implementation Decisions

- The MVP is the workflow-first single-operator AFK dogfood loop. Tracker issue automation is an
  intake and projection capability, not the product identity.
- The first required Workflow Definition is `single-operator-afk-coder`. It is configurable and
  lives as YAML under the repo workflow directory.
- Workflow YAML is config-authored and may reference only built-in action, role, hook, gate,
  validation profile, model profile, and artifact contract IDs. Arbitrary shell commands are out of
  MVP and can later arrive as a typed action with timeout, inputs, outputs, and evidence contracts.
- The runtime must generalize to multiple workflows. MVP ships one workflow but builds a schema,
  registry, resolver, validator, and executor that do not hard-code that workflow.
- The workflow engine executes canonical states, role DAGs, hooks, gates, and transitions. DAG-capable
  configuration is required, but MVP execution may be linear unless dependencies require otherwise.
- Hooks run deterministic side effects and evidence collection. Gates decide mechanical pass/fail.
  LLM roles may propose completion but cannot bypass gates.
- The verifier role or verifier council is the authority for semantic intent satisfaction. Mechanical
  gates verify that the verifier process completed and produced a valid `verification.v1`; they do
  not reduce semantic satisfaction to vote counts.
- The initial role pack is planner, implementer, reviewer, verifier, and CI babysitter. Reviewer and
  verifier are separate roles even if they use the same harness.
- The verifier is isolated to a fixed input allowlist: the original `intent.v1`, `plan.v1`,
  `change_summary.v1`/diffs, `review.v1`, validation output, publish output, CI output, and evidence
  links. It never sees the implementer transcript, and it compares against the original `intent.v1`,
  not a restatement of it.
- Verifier mode is configurable as single (default) or council. Council mode runs diverse councillors
  (distinct model profiles and lenses) in parallel; a synthesizer model always produces the decision
  (satisfied, not_satisfied, or uncertain) plus a consensus tag (`unanimous`/`majority`/`split`).
  Individual councillor results and any split are captured in `verification.v1` and surfaced in the
  handoff and the auto-merge approval prompt — not auto-escalated by a hard rule.
- Per-role model profiles are required. Resolution is two levels: the value in the definition, else a
  global default (the per-workspace tier is cut for now); resolved values are stamped on the run. The
  verifier should be at least as strong as the implementer by default, and a different model
  family/provider should be possible.
- Artifacts are strict runtime-validated JSON records. Required MVP contracts are `intent.v1`,
  `plan.v1`, `change_summary.v1`, `review.v1`, `validation_result.v1`, `publish_result.v1`,
  `verification.v1`, `ci_result.v1`, `handoff.v1`, `operator_response.v1`, and
  `operator_approval.v1`.
- Every artifact includes contract ID, version, Workflow Run ID, creation time, and contract-specific
  required fields. Freeform notes may exist, but gates never depend on prose.
- Validation profiles are built in. MVP includes a Node/pnpm standard profile suitable for Risoluto
  and a repo-declared profile if safe to infer. Validation failure handling is configurable.
- Recovery uses configurable LLM retries per failed gate, defaulting to one. Wall-clock time and
  measured cost are hard-stop budgets, defaulting to 120 minutes and 10 USD unless overridden. Measured
  cost is the running total of token usage × per-model-profile price (input, output, and cache
  read/write tokens), checked between steps; it reuses the existing usage accounting in
  `src/orchestrator/core/lifecycle-state.ts`, extended with cache-token fields on `TokenUsageSnapshot`.
- Slack may request budget override once per run, only to a new explicit cap, recorded in
  `operator_approval.v1`.
- Workspaces are configured explicitly. A run must select a configured workspace. If only one
  workspace exists, interfaces may preselect it, but the run still records it explicitly.
- The primary workspace config combines repo identity, worktree behavior, validation profile, allowed
  workflows, publishing, CI, status mapping, branch template, dirty policy, and worktree retention.
  Existing repo routing remains a compatibility/migration layer rather than the primary model.
- Code-changing MVP workflows always use Git worktree isolation. Branch naming is template-driven,
  unique, sanitized, length-bounded, and workspace/workflow configurable.
- Dirty existing checkout policy is configurable as reject, auto_stash, or require_approval.
  `auto_commit_dirty` is excluded from MVP.
- Worktree retention defaults to seven days and is configurable per workspace. PR worktrees are kept
  until PR merged/closed; blocked and cancelled worktrees are retained until resolved or expired.
- PR modes are none, draft, ready, incomplete_draft, and auto_merge. Draft is the default. Incomplete
  draft requires operator approval and leaves the run blocked.
- Ready PR requires local validation green, verifier satisfied, and remote CI green (CI babysitter
  required for ready and auto-merge modes; see user story 52). Auto-merge requires local
  validation green, PR creation, remote CI green, post-publish verifier satisfied, Slack approval by
  an operator with auto-merge permission, and merge policy satisfaction.
- A CI/CD adapter contract is required, with GitHub Actions as the first implementation. Provider
  config lives under workspace CI settings with workflow override.
- CI babysitter is a hybrid role/action loop. Deterministic code polls providers, fetches logs,
  reruns checks when allowed, and records status. LLM judgment classifies failure cause, summarizes
  evidence, and routes fixable failures back to implementation.
- Slack is a first-class intake and operator-control adapter. MVP includes slash command, modal start,
  interactive buttons, clarification replies, approvals, cancellation, retry, and handoff delivery.
- Slack inbound must verify provider signatures, timestamp replay window, allowed team/workspace, and
  mapped operator permissions. Every inbound Slack action is recorded.
- Operator permissions (standing capabilities) include start_run, answer_clarification,
  approve_pr_create, approve_budget_override, approve_destructive_action, approve_secret_access,
  approve_auto_merge, and cancel_run; view status is implied for mapped operators. Distinct from
  permissions, each `operator_approval.v1` is a per-action, scoped, single-use record referencing the
  exact run, the exact action, and a nonce carried by the Slack button — a stale or duplicate tap does
  nothing. The Slack-user→operator mapping lives in workspace config.
- Automatic Linear/GitHub issue intake is supported through explicit intake rules. Rules match labels,
  states, workflow labels, workspace labels, and provider-specific fields. Webhooks provide the fast
  path; polling provides anti-entropy reconciliation.
- Idempotency has two layers: provider delivery dedupe by provider and delivery ID, and logical run
  mapping keyed by provider and external object ID only (the intake rule is recorded as metadata, not
  part of the key, so one issue is one run). Two rules matching one issue is an ambiguous-intake
  rejection, not two runs. The logical mapping is claimed transactionally before side effects and maps
  to a fresh Risoluto-owned Workflow Run ID — never the tracker issue ID. This work fixes the
  run-vs-issue identity collapse in ADR-0001 §1; it does not extend it.
- Explicit retry from Linear/GitHub labels or comments, Slack buttons, or CLI creates a new Run
  Attempt under the same Workflow Run by default.
- Run Status (operational, the same for every workflow) is accepted, queued, running,
  waiting_for_operator, blocked, done, and cancelled. Workflow State (validate, publish, etc.) is a
  separate per-definition axis, not a Run Status value. Adapters project boards from Run Status;
  mappings are explicit and live at workspace level with workflow override.
- Unmapped adapter status blocks projection until configured. External status is a projection, not
  the source of Workflow Run truth.
- The experimental HTTP API is well-documented (not promoted to a primary surface — CLI stays primary)
  for runs, workflows, events, artifacts, intake, Slack, webhooks, and doctor. It uses bearer-token
  auth for normal API calls and provider-native signatures for webhook/Slack endpoints.
- User-facing CLI uses `risoluto run` commands while low-level `workflow-run` commands may remain for
  debugging and migration.
- Evidence archive is local filesystem first, with storage boundaries that can become a port later.
  Structured artifacts and raw evidence are stored separately.
- All evidence is stored with redaction policy. Evidence includes role transcripts/session IDs,
  action stdout/stderr, validation logs, CI logs, diffs/stats, PR/API responses, Slack metadata, and
  provider webhook payload metadata.
- Memory tiers are Attempt Memory (same run, for retries) and Project Memory candidates; the evidence
  archive is the store they draw from, not a tier, and Run Memory (cross-run) is reserved for later.
  Project memory promotion is configurable, defaulting to propose-only. Approved project memory is
  local/private by default inside workspace metadata.
- Repo documentation candidates require explicit approval and PR. Raw evidence is never committed by
  default.
- `handoff.v1` is both structured JSON and rendered Markdown. It is compact, redacted,
  artifact-linked, evidence-linked, and includes suggested skills.
- `risoluto doctor` is required. It is read-only by default and supports `--live` for write tests.
- TUI is deferred from MVP. OpenTUI is recorded as the preferred future TUI candidate, but not part
  of this PRD.

### ADDENDUM (D1) — Agent→artifact deposit protocol (2026-06-01)

The PRD assumed roles emit typed artifacts but never said _how_ an LLM role's session output becomes a
contract-valid artifact the executor can read back. Building the production `runRole`/`runAction`
providers (SEAM 1, RIS-198) forces that decision. This addendum fixes it; it adds no new contracts and
no new surface — it only makes the existing role→artifact boundary explicit. Affects RIS-198 (executor
reachability), RIS-201/207 (verifier), RIS-204 (evidence), and the role-bearing slices.

- **Role→contract map (`role.produces`).** Each role deposits exactly the contracts in its workflow
  definition `produces` list, no more: planner → `plan.v1`; implementer → `change_summary.v1`;
  reviewer → `review.v1`; verifier → `verification.v1`; ci_babysitter → `ci_result.v1`. Actions deposit
  likewise: `run-validation-profile` → `validation_result.v1`; `publish-pr` → `publish_result.v1`;
  `poll-ci` → `ci_result.v1`; `write-handoff` → `handoff.v1`; `create-worktree` deposits none.
- **Canonical archive path.** An artifact lands at
  `{archiveRoot}/workflow-runs/{workflowRunId}/artifacts/{artifactId}.json` as `{ contractId, data }`,
  where `artifactId` is the contract id with the `.v1` suffix dropped (`plan.v1` → `plan`,
  `change_summary.v1` → `change_summary`, `review.v1` → `review`, `verification.v1` → `verification`,
  `ci_result.v1` → `ci_result`). This matches the intake convention already used for `intent.v1` →
  `intent`. Writes go through `archive.writeWorkflowRunArtifact`, which validates via
  `parseWorkflowRunArtifact` before persisting.
- **Completion signal.** A role completes by depositing a parseable artifact for _every_ contract in
  `role.produces`. The `runRole` adapter signals completion to the executor by returning a
  `Record<contractId, data>` containing exactly `role.produces`; the executor re-validates each with
  `parseWorkflowRunArtifact` (producer `{ type: "role", id }`) and stores it. A session that ends
  without a contract-valid artifact for each produced id is a hard failure — the executor throws "did
  not produce required artifact" and the run ends in a blocked handoff, never continuing on prose.
- **Read-back and typing boundary.** The adapter reads each deposited artifact back by `artifactId`
  (`archive.readWorkflowRunArtifact`), re-parses with `parseWorkflowRunArtifact`, and returns it keyed
  by `contractId`. The verifier artifact is additionally shaped through `verifier.ts` (single-mode
  build/route or `runCouncilVerifier`). The agent boundary (free-form session) and the typed boundary
  (strict Zod contract) stay cleanly separated: the agent deposits a valid artifact; the executor
  validates and routes it.
- **Effect-port seam.** Production binds `runRole` to the agent harness (`RunAttemptDispatcher` /
  `AgentRunner`) and `runAction` to real effects (`GitManager`, `GitHubPrClient`, the validation/CI
  adapters) through injected effect ports. CI-tier tests inject hermetic fakes for those ports but keep
  the path from the entry point through `driveWorkflowRun` real; the live tier exercises the real ports.

## Testing Decisions

- Tests should validate external behavior and contracts, not private implementation details. A good
  test starts from an intake, workflow config, artifact, adapter event, CLI/API command, or provider
  response and verifies the observable result.
- Workflow schema and registry tests should prove valid YAML loads, invalid references are rejected,
  two-level config resolution (definition then global default) resolves predictably, and workflow
  definitions cannot reference unknown roles, gates, hooks, actions, profiles, or contracts.
- Workflow executor tests should prove state transitions, hook/action ordering, gate evaluation,
  retry behavior, budget stops, and blocked/done outcomes from realistic run inputs.
- Artifact contract tests should prove every MVP contract accepts valid examples, rejects malformed
  producer output, and exposes the fields gates need without relying on freeform prose.
- Intake tests should cover CLI, Slack modal, Linear webhook/polling, GitHub webhook/polling,
  ambiguous labels, unknown workspace, unknown workflow, duplicate delivery, duplicate external
  object mapping, and explicit retry.
- Idempotency tests should include webhook duplicate delivery, webhook plus polling race, repeated
  issue edit, and transactionally claimed external mapping.
- Workspace/worktree tests should cover configured workspace resolution, branch template rendering,
  branch sanitization, uniqueness fallback, worktree creation, retention classification, and dirty
  policy behavior.
- Validation profile tests should verify command ordering, stop-on-first behavior, collect-all
  behavior where configured, validation evidence capture, and LLM retry routing.
- Verifier tests should cover single verifier satisfied, not_satisfied, uncertain with Slack answer,
  uncertain timeout with retry, verifier-triggered implementation retry, and deterministic gate
  precedence over verifier optimism.
- Council verifier tests should cover partial councillor failure, all councillors failed, split
  evidence captured, synthesizer decision accepted, and schema-valid `verification.v1` output.
- PR publishing tests should cover draft, ready, incomplete draft, and auto-merge gating behavior,
  including operator approval requirements.
- CI adapter tests should target the adapter contract, using GitHub Actions fakes/fixtures for unit
  and integration tests, plus live checks only under explicit live profiles.
- CI babysitter tests should cover pending checks, green checks, code-caused failure, flaky rerun,
  unavailable provider, timeout, log summarization, and route-back-to-implementer behavior.
- Slack tests should verify signature validation, replay rejection, team allowlist, operator mapping,
  permission enforcement, modal payload parsing, button payload parsing, clarification artifact
  creation, approval artifact creation, and rejection of unauthorized risky actions.
- HTTP API tests should verify bearer auth, run creation, run status, events, artifacts, cancel,
  retry, workflow list/validate, doctor, and provider endpoint auth behavior.
- Status projection tests should verify canonical statuses, workspace mapping, workflow override,
  unknown adapter state handling, and mirror/comment side effects.
- Evidence and redaction tests should verify raw evidence is written, sensitive fields are redacted
  for export/display, structured artifacts are stored separately, and evidence links in handoff
  resolve locally.
- Memory tests should verify Attempt Memory is available for retries, project memory candidates include
  provenance, local/private is default visibility, repo-doc candidates are not committed
  automatically, and raw evidence never becomes repo memory by default.
- Handoff tests should verify structured JSON and rendered Markdown are produced, required sections
  exist, artifact/evidence links are references rather than full dumps, redactions are listed, and
  suggested skills are included.
- Doctor tests should verify read-only checks do not mutate providers and `--live` tests are gated
  behind explicit invocation. Use existing health/config/test patterns where possible.
- End-to-end dogfood tests should prove at least one run from CLI, one run from Slack, and one run
  from tracker intake reach a reviewable draft PR or an honest blocked handoff without duplicate run
  creation.

## Out of Scope

- TUI implementation. OpenTUI is the preferred future candidate but not part of this MVP.
- Scheduled or recurring workflow starts.
- Full public workflow marketplace.
- Full external plugin API.
- Arbitrary shell commands embedded directly in workflow YAML.
- User-authored programming DSL beyond config-authored YAML with built-in references.
- Multi-tenant SaaS, billing, hosted control plane, or tenant administration.
- Jira, GitLab, Buildkite, CircleCI, Jenkins, or other non-GitHub CI/tracker providers beyond the
  adapter contracts needed to add them later.
- Web dashboard or docs-site rebuild.
- Auto-commit dirty workspace policy.
- Silent automatic promotion of raw evidence or operational memory into the target repository.
- Auto-merge without Slack approval, green required checks, merge policy satisfaction, and
  post-publish verifier satisfaction.
- Treating Linear or GitHub issue identity as the Workflow Run identity.

## Further Notes

- The implementation should update the ADR implementation status tables as runtime drift is closed,
  especially around Workflow Run identity, Workflow Definitions, artifact validators, hook/gate
  execution, and event-sourced state.
- The PRD intentionally widens MVP beyond CLI-only by including Slack, HTTP, Linear/GitHub intake,
  GitHub Actions, and doctor. The scope remains coherent because every surface feeds or projects the
  same Workflow Run engine.
- The thinnest useful build order is workflow schema/registry, engine, artifacts/evidence, worktree,
  CLI/HTTP start/status, validation/verifier, PR/CI, Slack, automatic tracker intake, memory/handoff,
  and doctor.
- The first implementation pass should prefer deep modules with small interfaces: workflow registry,
  workflow executor, artifact contract registry, intake rule engine, external-run mapping store,
  workspace resolver, CI adapter, Slack adapter, verifier/council runner, evidence store, memory
  candidate builder, status projector, and doctor runner.
- The Linear project mirror for this PRD is generated from git. Git remains the canonical PRD source.
