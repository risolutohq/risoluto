# Risoluto — Technical Spine

> The v1 technical spine is **maximal** — it names every layer Risoluto's foundation must accommodate, even if v1 does not ship a complete implementation of each. The spine governs source classification and boundary discipline.

---

## Scope

These are the v1 spine surfaces. Kept source should map to one of them, or be removed/deferred through the capability backlog, decision register, or Linear.

1. **Core workflow engine** — Workflow Run lifecycle, transitions, gate evaluation.
2. **Workflow Run model** — durable, retryable, replayable execution record.
3. **Workflow Definition model** — reusable state-machine / graph template.
4. **State machine with graph execution inside states** — outer states are sequential; intra-state Role Execution is a typed DAG.
5. **Role Execution runtime** — invokes an Agent Role, wires up its harness / worker / model, collects artifacts.
6. **Typed Artifact Contracts** — schemas describing the artifacts that roles produce and consume.
7. **Durable artifact and raw evidence storage** — both the structured artifact and the raw harness-native record.
8. **Event-sourced Run Log with policy** — retention, redaction, export.
9. **Memory Builder and Memory Manager concepts** — defined; Attempt Memory implemented first.
10. **Hooks, Gates, and Transitions as separate concepts.**
11. **Tracker Adapters** — Linear / GitHub Issues / GitLab / Jira behind a single contract.
12. **Board Projection Contract** — tracker board semantics exposed by adapters; v1 documents the contract only.
13. **PR / MR Adapters** — GitHub / GitLab.
14. **Harness Adapters** — Codex, Claude Code, Cursor, custom.
15. **Model / provider configuration** — explicit / name-based first.
16. **Versioned skill packs** — product artifacts; live in the main repo first.
17. **Scheduler / retry / concurrency** — for Workflow Runs and Role Executions.
18. **Control plane / execution plane split** — first implementation single-node, architecture portable.
19. **Observability, audit, replay, export.**
20. **CLI as primary interface.**
21. **TUI as next first-class interface.**
22. **HTTP API as support / internal surface** — not the primary product surface.

## Layering

Top-down:

```
+--------------------------------------------------------------+
|  Operator Surfaces                                           |
|    CLI (primary)   TUI (next)   HTTP (internal/support)      |
+--------------------------------------------------------------+
|  Intake & Mirror                                             |
|    Tracker Adapters   PR/MR Adapters   Webhook + Polling     |
+--------------------------------------------------------------+
|  Core Workflow Engine                                        |
|    Workflow Run · Workflow Definition · State Machine ·      |
|    Transitions · Gates · Hooks · Scheduler · Retry · Memory  |
+--------------------------------------------------------------+
|  Role Execution Runtime                                      |
|    Agent Roles · Role Execution · Typed Artifact Contracts · |
|    Harness Adapters · Model/Provider Config · Skill Packs    |
+--------------------------------------------------------------+
|  Persistence & Evidence                                      |
|    Artifact Store · Raw Evidence Store · Event-Sourced Log · |
|    Memory Store · Redaction & Export Policy                  |
+--------------------------------------------------------------+
|  Control Plane  /  Execution Plane Split                     |
|    (single-node default; portable to customer-controlled)    |
+--------------------------------------------------------------+
|  Observability                                               |
|    Audit · Replay · Export · Metrics · Trace                 |
+--------------------------------------------------------------+
```

## Boundary Rules

- **Ports are the contract.** Tracker / harness / PR / model integrations live behind typed ports. Code that reaches around a port (e.g., directly calling `LinearClient` from the orchestrator) is wrong.
- **Plane separation.** Control-plane code never assumes execution-plane locality. Execution-plane code never assumes control-plane authority over secrets.
- **Skill packs are versioned and discoverable** through the same registry contract whether they live in-tree (v1) or out-of-tree (post-v1).
- **Hooks ≠ Gates ≠ Transitions.** A hook is a side-effect / extension point. A gate is a proof requirement. A transition is a state change. They share an execution context but are different concepts and stay separate code paths.
- **v1 does not expose an external plugin API.** Plugin boundaries exist in the type system; the public extension surface is deferred.

## Adapter Surfaces (v1 contracts only, not full implementations)

| Surface          | v1 Contract                                                         | v1 Implementation                            |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| Tracker          | `TrackerPort` (intake, mirror, board projection)                    | Linear (first), CLI / direct ingest (second) |
| PR / MR          | `PrPort` (open, comment, status)                                    | GitHub PRs                                   |
| Harness          | `HarnessPort` (spawn role, collect artifacts, stream evidence)      | Codex (first)                                |
| Model / provider | `ModelProvider` config                                              | Anthropic, OpenAI (explicit name-based)      |
| Persistence      | `WorkflowRunStore`, `ArtifactStore`, `EventLogStore`, `MemoryStore` | SQLite + filesystem (single-node)            |

Other tracker / PR / harness implementations are backlog (see [capability backlog](./capability-backlog.md)).

## What v1 Implementation Does Not Cover

The spine **defines** these; v1 implementation **does not ship them**:

- Full Memory Manager retrieval / indexing across all tiers.
- Full Board Projection implementation (contract only).
- Jira / GitLab / GitHub-Issues tracker adapters (Linear only).
- User-authored workflow DSL (built-in TypeScript Workflow Definitions only — see [ADR-0005](./adr/0005-built-in-typescript-workflow-definitions-before-dsl.md)).
- External plugin API.
- Web dashboard / frontend.
- Hosted SaaS control plane.

## Related Docs

- [Product Spine](./product-spine.md) — what Risoluto is and the canonical terms.
- [ADRs](./adr/) — the foundational technical decisions that shaped this spine.
- [Decisions Register](./decisions.md) — chronological log of everything else.
- [Testing Strategy](./testing-strategy.md) — how spine surfaces get covered.
- [Release Rules](./release-rules.md) — `0.x` allowances and `1.0.0` qualification.
