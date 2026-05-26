---
slug: provider-abstraction
linear_project: https://linear.app/ninetech/project/provider-abstraction-d0cca40a8790
synced_at: 2026-05-26T21:19:57.161Z
source_idea: research/ideas/provider-abstraction/README.md
status: draft
---

## Problem Statement

Risoluto operators today have one harness wired into the runtime — whichever family it was bootstrapped against — and switching to a different one (Claude Code vs OpenCode/Codex CLI) means rewriting how a workflow run dispatches its agent steps. That coupling is structural: the harness's tool-call schema, streaming semantics, and process model leak into the run executor. Two adjacent peers ship a cleaner shape — Composio abstracts SaaS **tool** providers behind one SDK across 1000+ connectors, and Magpie abstracts **LLM CLI** providers (Claude Code, Codex CLI, Gemini, Qwen) behind one adversarial-debate harness — but neither encodes the workflow run as the canonical unit. Risoluto does, which means a provider here is just an effect-carrying step inside the run, not the unit of identity. The wedge is real now: the Claude Code-flavoured and OpenCode/Codex-flavoured harness families are diverging on tool-use semantics fast enough that locking in one will force a rewrite later.

## Solution

Introduce a single `Provider` interface that adapts `(workflowRun, step) → effect`. Ship two adapters in v1: `claude-code` and `opencode`. The CLI picks an adapter per run via `risoluto run --provider=<name>`; the default is read from `risoluto.config.ts`. The run executor is the only caller of the interface — every other surface (TUI, HTTP, scheduler) stays agnostic. No discovery, no marketplace, no per-tool routing in v1 — those are follow-ups once the seam holds against real workloads.

## User Stories

1. As a Risoluto operator, I want to run the same workflow against Claude Code or OpenCode without rewriting the workflow definition, so that I can A/B providers on the same backlog without forking my run scripts.
2. As a Risoluto operator, I want a single `--provider=<name>` flag on `risoluto run`, so that switching providers is a CLI argument, not a config edit.
3. As a Risoluto operator, I want a project-level default provider in `risoluto.config.ts`, so that my team doesn't have to remember the flag every time.
4. As an agent author, I want the `Provider` interface to be the only surface I implement, so that I don't have to learn the workflow-run internals to add a new harness.
5. As an agent author, I want the interface to take a workflow run + step (not raw prompt + tools), so that step retries, run-level state, and effect ordering are handled by Risoluto, not duplicated per provider.
6. As a CI consumer, I want the provider choice recorded in the workflow run's event log, so that I can replay runs against a different provider for diff analysis.
7. As a Risoluto core maintainer, I want the v1 adapters to live in-tree (not as packages), so that I can refactor the interface without coordinating releases across repos.
8. As a future skill author, I want adapters to register declaratively (a single export, no side effects), so that adding a third adapter is a self-contained PR.
9. As an operator who hits a provider-specific bug, I want a clear `risoluto run --provider=<name>` invocation that surfaces the provider error verbatim, so that I can file a bug against the right upstream.

## Implementation Decisions

- The `Provider` interface lives at the run-executor seam, not at the tool-call seam. Composio's wedge (per-tool provider routing) is explicitly out of scope for v1 — that's a follow-up backlog entry once we know what cross-provider tool composition actually looks like in practice.
- The interface is `(workflowRun, step) → Promise<StepEffect>` — workflow run is the canonical unit, step is the executable atom, effect is what gets written back to the run's event log. Mirroring Magpie's per-provider isolation rather than Composio's per-tool routing matches Risoluto's run-as-canonical-unit spine.
- Two adapters in v1: `claude-code` and `opencode`. Pick those two because they cover the two diverging harness families operators are actively choosing between right now.
- Adapter registration is via a single exported `Provider` object per adapter file. No plugin loader, no manifest. The run executor imports adapters from a fixed in-tree directory.
- Provider choice is recorded in the workflow run event log as a top-level field — replay tooling can diff a run against an alternate provider without re-parsing config.
- No auth-management surface in v1. Each adapter consumes whatever environment the operator has already set up (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — Composio's auth-management is a separate backlog item.

## Testing Decisions

- Integration tests (`vitest.integration.config.ts`) drive a fake adapter through a real workflow run and assert the event log records every step's effect in order. Tests focus on the seam between executor and provider, not the LLM call itself.
- One live test per adapter under `vitest.live.config.ts` exercises a trivial workflow against the real provider. Gated by `.env.live.local`; runs in CI only when the relevant secret is set.
- No mocks of the adapters at unit-test layer. The fake adapter is a real implementation of the interface — that catches interface drift without sacrificing the run-executor behaviour we actually care about.
- Prior art: `vitest.integration.config.ts` already exercises run-executor seams against deterministic fixtures; the new tests follow the same shape.

## Out of Scope

- Per-tool provider routing (Composio's wedge).
- Multi-provider debate runs (Magpie's wedge).
- Provider discovery / marketplace / dynamic plugin loading.
- Auth-management surface beyond environment variables.
- Cross-provider replay / diff tooling (the event-log field is the foundation, but the diff UI is a follow-up).
- A third adapter (e.g., Gemini CLI). Two adapters is enough to validate the seam; a third becomes a 50-line PR once v1 holds.

## Further Notes

The Phase 3.3 PRD drift hook will diff the Linear Project description against this PRD body section-by-section, so keep the headings stable as the PRD evolves. If a new section is added, add it to the Linear UI banner template under `docs/prds/README.md` too.

Once the v1 seam is in production, the synthesizer is likely to surface a `tool-provider-abstraction` follow-up idea (Composio's wedge) — that becomes a separate PRD, not an expansion of this one.
