# Capability Backlog

> The **living** post-foundation work ledger. Replaces static roadmap/status ledgers. No preplanned v2 / v3 / v4 — work enters as capabilities the foundation makes possible, gets prioritized when an operator-observed gap is real, and exits when shipped (or explicitly dropped).

**Canonical discovery surface.** `capability-backlog.md` is the place to scan and pick ideas. `research/INDEX.md` and the vault Dataview view are complementary views, not entry points.

## Status Vocabulary

| Status        | Meaning                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| **idea**      | Named; needs more thinking before it's actionable.                                                               |
| **ready**     | Scoped enough to start work on; awaiting capacity / priority.                                                    |
| **in-flight** | Active Linear work; usually has issues mirrored to GitHub.                                                       |
| **shipped**   | Merged in canonical repo; reflected in [release-rules.md](./release-rules.md) cadence.                           |
| **dropped**   | Explicitly killed (operator records the rationale in the idea's Analyst notes; not auto-written to the backlog). |

## Categories

These are the buckets v1's foundation makes possible. Backlog entries fall under one.

- **Workflow Definitions** — new built-in shapes (spec-first interviewer, plan-first loop, N-agent fanout + grade, adversarial reviewer, release-readiness gate, learning-from-failures retry).
- **Tracker Adapters** — GitHub Issues, GitLab, Jira; webhook-vs-poll posture per adapter.
- **Harness Adapters** — Claude Code, Cursor, custom harnesses beyond Codex.
- **Memory Manager** — full retrieval / indexing across Attempt / Run / Project tiers.
- **Board Projection** — tracker-faithful UI with Risoluto overlays.
- **Operator Surfaces** — TUI graduation, HTTP API surface hardening, and any later web surface only if the deferred decision in [decisions.md](./decisions.md) is explicitly reactivated.
- **Cost / Reliability** — cost ceiling + kill-switch, multi-provider failover, alert-tier policy, queue-aware sequencing, partial-completion safety net.
- **Plugin API** — external extension surface (deferred until first non-operator request).
- **Hosted Modes** — enterprise customer-controlled execution plane; hosted SaaS control plane.
- **Skill Packs** — discovery, versioning, future marketplace.

## Cadence

- **Add an entry** when a capability is named in operator session, ADR, or Linear ticket.
- **Promote `idea` → `ready`** when scope and trigger are written down (don't promote without both).
- **Promote `ready` → `in-flight`** when Linear planning work is created.
- **Close** with a link to the merged PR (or a note in the idea's Analyst notes explaining why it was dropped).

## Initial Entries

<!-- BEGIN risoluto-synthesizer:idea-rows -->

| slug                      | name                      | category             | status | evidence_idea                                      |
| ------------------------- | ------------------------- | -------------------- | ------ | -------------------------------------------------- |
| activity-signal           | Activity Signal           | Cost / Reliability   | idea   | research/ideas/activity-signal/README.md           |
| adversarial-debate        | Adversarial Debate        | Workflow Definitions | idea   | research/ideas/adversarial-debate/README.md        |
| agent-tools               | Agent Tools               | Skill Packs          | idea   | research/ideas/agent-tools/README.md               |
| auth-management           | Auth Management           | Operator Surfaces    | idea   | research/ideas/auth-management/README.md           |
| cli-reviewer              | CLI Reviewer              | Harness Adapters     | idea   | research/ideas/cli-reviewer/README.md              |
| code-aware-verification   | Code-Aware Verification   | Workflow Definitions | idea   | research/ideas/code-aware-verification/README.md   |
| context-gathering         | Context Gathering         | Memory Manager       | idea   | research/ideas/context-gathering/README.md         |
| convergence-detection     | Convergence Detection     | Workflow Definitions | idea   | research/ideas/convergence-detection/README.md     |
| dual-sdk                  | Dual SDK                  | Plugin API           | idea   | research/ideas/dual-sdk/README.md                  |
| feature-analysis          | Feature Analysis          | Workflow Definitions | idea   | research/ideas/feature-analysis/README.md          |
| git-worktree-isolation    | Git Worktree Isolation    | Cost / Reliability   | idea   | research/ideas/git-worktree-isolation/README.md    |
| inline-pr-comments        | Inline PR Comments        | Tracker Adapters     | idea   | research/ideas/inline-pr-comments/README.md        |
| lifecycle-state-machine   | Lifecycle State Machine   | Workflow Definitions | idea   | research/ideas/lifecycle-state-machine/README.md   |
| mcp                       | MCP                       | Plugin API           | idea   | research/ideas/mcp/README.md                       |
| multi-ai-review           | Multi-AI Review           | Workflow Definitions | idea   | research/ideas/multi-ai-review/README.md           |
| orchestrator-as-agent     | Orchestrator-as-Agent     | Workflow Definitions | idea   | research/ideas/orchestrator-as-agent/README.md     |
| parallel-execution        | Parallel Execution        | Workflow Definitions | idea   | research/ideas/parallel-execution/README.md        |
| plugin-architecture       | Plugin Architecture       | Plugin API           | idea   | research/ideas/plugin-architecture/README.md       |
| provider-abstraction      | Provider Abstraction      | Harness Adapters     | idea   | research/ideas/provider-abstraction/README.md      |
| reaction-engine           | Reaction Engine           | Workflow Definitions | idea   | research/ideas/reaction-engine/README.md           |
| sandboxed-execution       | Sandboxed Execution       | Cost / Reliability   | idea   | research/ideas/sandboxed-execution/README.md       |
| session-management        | Session Management        | Memory Manager       | idea   | research/ideas/session-management/README.md        |
| session-persistence       | Session Persistence       | Memory Manager       | idea   | research/ideas/session-persistence/README.md       |
| structured-output-parsing | Structured Output Parsing | Harness Adapters     | idea   | research/ideas/structured-output-parsing/README.md |
| tool-registry             | Tool Registry             | Skill Packs          | idea   | research/ideas/tool-registry/README.md             |
| tracker-integration       | Tracker Integration       | Tracker Adapters     | idea   | research/ideas/tracker-integration/README.md       |
| webhook-triggers          | Webhook Triggers          | Tracker Adapters     | idea   | research/ideas/webhook-triggers/README.md          |

<!-- END risoluto-synthesizer:idea-rows -->

## Relation to Linear / GitHub

Linear is the **canonical** planning surface (see [research-to-shipping-pipeline.md](./research-to-shipping-pipeline.md)). This file is the **current-truth public summary** of what the foundation enables and what's queued — not a duplicate ticket database. When a backlog entry has live Linear work, link the Linear project / ticket from the entry. Public mirror to GitHub Issues is selective.
