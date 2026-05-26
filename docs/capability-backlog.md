# Capability Backlog

> The **living** post-foundation work ledger. Replaces static roadmap/status ledgers. No preplanned v2 / v3 / v4 — work enters as capabilities the foundation makes possible, gets prioritized when an operator-observed gap is real, and exits when shipped (or explicitly dropped).

## Status Vocabulary

| Status        | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| **idea**      | Named; needs more thinking before it's actionable.                                     |
| **ready**     | Scoped enough to start work on; awaiting capacity / priority.                          |
| **in-flight** | Active Linear work; usually has issues mirrored to GitHub.                             |
| **shipped**   | Merged in canonical repo; reflected in [release-rules.md](./release-rules.md) cadence. |
| **dropped**   | Explicitly killed; reason captured.                                                    |

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
- **Close** with a link to the merged PR (or the dropped-reason note).

## Initial Entries

<!-- BEGIN risoluto-synthesizer:idea-rows -->

| slug                      | name                      | category | status | evidence_idea                                      |
| ------------------------- | ------------------------- | -------- | ------ | -------------------------------------------------- |
| activity-signal           | Activity Signal           | TBD      | idea   | research/ideas/activity-signal/README.md           |
| adversarial-debate        | Adversarial Debate        | TBD      | idea   | research/ideas/adversarial-debate/README.md        |
| agent-tools               | Agent Tools               | TBD      | idea   | research/ideas/agent-tools/README.md               |
| auth-management           | Auth Management           | TBD      | idea   | research/ideas/auth-management/README.md           |
| cli-reviewer              | Cli Reviewer              | TBD      | idea   | research/ideas/cli-reviewer/README.md              |
| code-aware-verification   | Code Aware Verification   | TBD      | idea   | research/ideas/code-aware-verification/README.md   |
| context-gathering         | Context Gathering         | TBD      | idea   | research/ideas/context-gathering/README.md         |
| convergence-detection     | Convergence Detection     | TBD      | idea   | research/ideas/convergence-detection/README.md     |
| dual-sdk                  | Dual Sdk                  | TBD      | idea   | research/ideas/dual-sdk/README.md                  |
| feature-analysis          | Feature Analysis          | TBD      | idea   | research/ideas/feature-analysis/README.md          |
| git-worktree-isolation    | Git Worktree Isolation    | TBD      | idea   | research/ideas/git-worktree-isolation/README.md    |
| inline-pr-comments        | Inline Pr Comments        | TBD      | idea   | research/ideas/inline-pr-comments/README.md        |
| lifecycle-state-machine   | Lifecycle State Machine   | TBD      | idea   | research/ideas/lifecycle-state-machine/README.md   |
| mcp                       | Mcp                       | TBD      | idea   | research/ideas/mcp/README.md                       |
| multi-ai-review           | Multi Ai Review           | TBD      | idea   | research/ideas/multi-ai-review/README.md           |
| orchestrator-as-agent     | Orchestrator As Agent     | TBD      | idea   | research/ideas/orchestrator-as-agent/README.md     |
| parallel-execution        | Parallel Execution        | TBD      | idea   | research/ideas/parallel-execution/README.md        |
| plugin-architecture       | Plugin Architecture       | TBD      | idea   | research/ideas/plugin-architecture/README.md       |
| provider-abstraction      | Provider Abstraction      | TBD      | idea   | research/ideas/provider-abstraction/README.md      |
| reaction-engine           | Reaction Engine           | TBD      | idea   | research/ideas/reaction-engine/README.md           |
| sandboxed-execution       | Sandboxed Execution       | TBD      | idea   | research/ideas/sandboxed-execution/README.md       |
| session-management        | Session Management        | TBD      | idea   | research/ideas/session-management/README.md        |
| session-persistence       | Session Persistence       | TBD      | idea   | research/ideas/session-persistence/README.md       |
| structured-output-parsing | Structured Output Parsing | TBD      | idea   | research/ideas/structured-output-parsing/README.md |
| tool-registry             | Tool Registry             | TBD      | idea   | research/ideas/tool-registry/README.md             |
| tracker-integration       | Tracker Integration       | TBD      | idea   | research/ideas/tracker-integration/README.md       |
| webhook-triggers          | Webhook Triggers          | TBD      | idea   | research/ideas/webhook-triggers/README.md          |

<!-- END risoluto-synthesizer:idea-rows -->

## Relation to Linear / GitHub

Linear is the **canonical** planning surface (see [research-workflow.md](./research-workflow.md)). This file is the **current-truth public summary** of what the foundation enables and what's queued — not a duplicate ticket database. When a backlog entry has live Linear work, link the Linear project / ticket from the entry. Public mirror to GitHub Issues is selective.
