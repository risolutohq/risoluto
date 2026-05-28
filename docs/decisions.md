# Decisions Register

> A lightweight chronological log of meaningful Risoluto decisions. **Most decisions live here.** Hard-to-reverse foundational decisions also get a full ADR under [`adr/`](./adr/) — those rows link out.
>
> A decision is added at acceptance, never silently. Status changes (`active` → `superseded`, `active` → `deferred`) keep the original row intact and add a follow-up row referencing it.

## Status Vocabulary

| Status         | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| **active**     | In force. Code, docs, and reviewer behavior should match.                                |
| **superseded** | Replaced by a later decision; row stays for traceability and the supersession is linked. |
| **deferred**   | Acknowledged decision deliberately not made yet; trigger condition noted.                |

## Register

| #   | Date       | Title                                                                 | Status   | Summary                                                                        | Link                                                                          |
| --- | ---------- | --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | 2026-05-24 | Product name stays "Risoluto"                                         | active   | Identity carries across the transition.                                        | —                                                                             |
| 2   | 2026-05-24 | Canonical org is `risolutohq`                                         | active   | New public home; pre-v1 repository is archived for history.                    | —                                                                             |
| 3   | 2026-05-24 | Canonical repo is `risolutohq/risoluto`, public                       | active   | MIT, public, single canonical home.                                            | —                                                                             |
| 4   | 2026-05-24 | Curated snapshot import, no git history                               | active   | `0.1.0` is a fresh import, not a graft of previous history.                    | —                                                                             |
| 5   | 2026-05-24 | Versioning model: `0.1.0` → `0.x` → `1.0.0` → SemVer                  | active   | `1.0.0` = Foundation Baseline, not broad production maturity.                  | [release-rules.md](./release-rules.md)                                        |
| 6   | 2026-05-24 | Linear is canonical for internal planning                             | active   | GitHub Issues is public intake / mirror only.                                  | [research-to-shipping-pipeline.md](./research-to-shipping-pipeline.md)        |
| 7   | 2026-05-24 | Workflow Run is the core primitive                                    | active   | Foundational. Replaces issue-centric core model.                               | [ADR-0001](./adr/0001-workflow-run-as-core-primitive.md)                      |
| 8   | 2026-05-24 | State machine with graph execution inside states                      | active   | Outer sequential states; intra-state role DAG.                                 | [ADR-0002](./adr/0002-state-machine-with-graph-inside-states.md)              |
| 9   | 2026-05-24 | Typed Artifact Contracts between role executions                      | active   | Inter-role communication is typed, not freeform.                               | [ADR-0003](./adr/0003-typed-artifact-contracts.md)                            |
| 10  | 2026-05-24 | Event-sourced Run Log with retention / redaction / export policy      | active   | One source of truth for replay, audit, and export.                             | [ADR-0004](./adr/0004-event-sourced-run-log-with-policy.md)                   |
| 11  | 2026-05-24 | Built-in TypeScript Workflow Definitions before a user-authored DSL   | active   | DSL is a backlog item; v1 ships TS definitions.                                | [ADR-0005](./adr/0005-built-in-typescript-workflow-definitions-before-dsl.md) |
| 12  | 2026-05-24 | Environment-portable control / execution plane split                  | active   | Single-node first; portable to customer-controlled execution.                  | [ADR-0006](./adr/0006-environment-portable-control-and-execution-plane.md)    |
| 13  | 2026-05-24 | v1 does not implement SaaS billing or tenancy                         | active   | Architecture stays hospitable; product doesn't ship it.                        | —                                                                             |
| 14  | 2026-05-24 | First implementation target is single-node self-hosted                | active   | Dogfood loop on operator's machine.                                            | —                                                                             |
| 15  | 2026-05-24 | Linear-triggered dogfood is the first serious workflow                | active   | CLI intake is secondary; proves tracker is just an adapter.                    | —                                                                             |
| 16  | 2026-05-24 | Hooks, Gates, Transitions stay separate concepts                      | active   | Distinct primitives; do not collapse.                                          | —                                                                             |
| 17  | 2026-05-24 | Plugin boundaries are typed, but no external plugin API in v1         | active   | Internal extension only; public API is post-v1.                                | —                                                                             |
| 18  | 2026-05-24 | Model / harness selection is explicit / name-based first              | active   | Smart routing is a later layer.                                                | —                                                                             |
| 19  | 2026-05-24 | Skill packs are versioned product artifacts in the main repo          | active   | Marketplace is post-v1.                                                        | —                                                                             |
| 20  | 2026-05-24 | CLI primary surface; TUI next; HTTP API support / internal            | active   | No web frontend in v1.                                                         | —                                                                             |
| 21  | 2026-05-24 | Memory tiers defined: Attempt / Run / Project                         | active   | All three named in v1; Attempt Memory implemented first.                       | —                                                                             |
| 22  | 2026-05-24 | Webhook fast-path + polling anti-entropy for tracker intake           | active   | Default reliability pattern.                                                   | —                                                                             |
| 23  | 2026-05-24 | A Workflow Run can have multiple Run Attempts                         | active   | Attempt Memory rides on this.                                                  | —                                                                             |
| 24  | 2026-05-24 | Board Projection contract documented in v1; implementation backlogged | deferred | Trigger: post-`1.0.0` once tracker adapter coverage broadens.                  | —                                                                             |
| 25  | 2026-05-24 | Full external plugin API                                              | deferred | Trigger: after first non-operator integration request lands.                   | —                                                                             |
| 26  | 2026-05-24 | Hosted SaaS control plane                                             | deferred | Trigger: after dogfood baseline + first external customer ask.                 | —                                                                             |
| 27  | 2026-05-24 | User-authored workflow DSL                                            | deferred | Trigger: after at least 3 built-in workflow definitions ship and pain is real. | [ADR-0005](./adr/0005-built-in-typescript-workflow-definitions-before-dsl.md) |
| 28  | 2026-05-24 | Web dashboard / frontend rebuild                                      | deferred | Trigger: after CLI / TUI parity is hit; only if operator demand justifies it.  | —                                                                             |
| 29  | 2026-05-27 | Research-to-shipping planning pipeline                                | active   | Five-phase skill chain: research → synthesize → grill → PRD → issues → TDD.    | [ADR-0007](./adr/0007-research-to-shipping-pipeline.md)                       |

## How to Add an Entry

1. Pick the next `#`.
2. Date = decision date (ISO `YYYY-MM-DD`), not write date.
3. Status starts `active` or `deferred`. Never start at `superseded`.
4. Summary is one line; details go in the linked file or PR.
5. If the decision is hard-to-reverse, also add a full ADR under [`adr/`](./adr/) and link from the row.

## Execution Status

Linear is the active planning and execution status source. This register records accepted decisions only; temporary execution notes should not be added here.
