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

_(Empty at v1 cut. First entries land after the curated snapshot import surfaces reusable code and after the first dogfood Workflow Run reveals real pain.)_

## Relation to Linear / GitHub

Linear is the **canonical** planning surface (see [research-workflow.md](./research-workflow.md)). This file is the **current-truth public summary** of what the foundation enables and what's queued — not a duplicate ticket database. When a backlog entry has live Linear work, link the Linear project / ticket from the entry. Public mirror to GitHub Issues is selective.
