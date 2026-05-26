# Bundle assignment rules

The spine groups features into 11 bundles. Bundles are sticky — they exist because they reflect how the team groups roadmap work, and consumers (the `risoluto-researcher` skill, anyone reading the spine) rely on consistent placement. **Don't invent new bundles lightly.**

## The 11 bundles, what belongs in each

### 1. Notifications, Chat & Triggers
External-facing event delivery and event ingress. Includes: notification channels (Slack, webhook, desktop), the persistent notification system, the alerting engine with cooldown, cron-scheduled automations, webhook ingress (Linear/GitHub), the trigger dispatch API, and the webhook inbox.
Heuristic: *does it deliver or accept events to/from outside Risoluto?*

### 2. Multi-Agent / Orchestration
The brain of the system. Polling, dispatch, concurrency, retries, blockers, the orchestrator stall detector, operator abort, in-flight steering, the TrackerPort abstraction, per-issue overrides (model, prompt, reasoning), continuation handling.
Heuristic: *does it decide what work runs next or how an attempt evolves?*

### 3. Persistence / State
Runtime-adjacent state concerns. Startup recovery, attempt checkpoints, pre-cleanup auto-commit, token accumulation, snapshot dirty-tracking, execution replay, attempt cost/duration analytics.
Heuristic: *does it manage state across an attempt's lifecycle, not just store it?*
**Contrast with bundle 11 (Persistence)**, which is the SQLite plumbing itself.

### 4. PR / CI
Everything downstream of a successful attempt that touches a pull request or CI. Completion writeback, git automation (commit/push/PR), auto-merge policy, PR summary generation, PR lifecycle monitoring, PR review feedback ingestion, self-review, PR status overview API, nightly CI failure issue automation.
Heuristic: *does it act on or around pull requests?*

### 5. Sandbox / Security
Container and workspace isolation. Docker container sandbox, Docker security hardening, per-issue workspace isolation with safety invariants, workspace lifecycle hooks, safe subprocess environment whitelist, OOM detection via docker inspect, container stats polling, cache volume chown init, workspace prep with skill-link pruning.
Heuristic: *does it isolate or constrain what an agent can touch?*

### 6. Agent Runtime / Execution
The turn loop itself. JSON-RPC transport, Codex app-server v2 init, turn execution with max-turns cap, stop-signal detection, debounced streaming, typed abort/error classification, SSE reconnection, dynamic tool registration, the `linear_graphql` and `github_api` tools, preflight, container startup timeout, codex model list validation.
Heuristic: *does it execute inside a single attempt's lifecycle?*

### 7. Dashboard
**Operator-observable HTTP + observability + (when present) SPA surface.** This bundle is broader than just "the web frontend" — it covers everything the operator interacts with via HTTP or observes about the system at runtime. Includes: runtime snapshot wire format, real-time SSE stream, HTTP API endpoints (issue inspector, runs/attempts, notifications), OpenAPI/Swagger, Prometheus endpoint, Observability Hub, watchdog health. AND — when the codebase has a frontend — SPA features: overview dashboard, kanban, log viewer, command palette, keyboard nav, sidebar, toast notifications, lazy-loaded routes.
Heuristic: *does an operator interact with it via browser OR observe its runtime state externally?*
Note: in v1 (early Risoluto) there is no SPA — populate this bundle with the HTTP/SSE/observability features only. The bundle name stays "Dashboard" as a forward-looking placeholder; the bundle scope adapts to the codebase.

### 8. Config
The config system and its derivations. LiquidJS templates, prompt template CRUD, persistent config overlay with deep merge, config overlay API, snake/camel case aliases, host-URL rewriter for containers, model catalog reader, dispatch preflight validation.
Heuristic: *does it shape, validate, or expose configuration?*

### 9. Security / Auth
Secrets and authentication primitives. AES-256-GCM file-backed secrets, SQLite per-row encrypted secrets, `$VAR` / `$SECRET:key` indirection, read/write guards, content sanitizer, HMAC webhook signature verification, PKCE OAuth for Codex, access-token refresh, audit logger, bearer auth middleware, setup wizard.
Heuristic: *does it gate, encrypt, or authenticate?*

### 10. Runtime
Process-level wiring. CLI entry with graceful shutdown, CLI argument parsing, service wiring (DI composition root), control/data-plane split, pre-computed runtime config for remote dispatch, HTTP server with loopback default, configurable workflow state machine, TypedEventBus backbone, jittered retry utility, data-plane health endpoint.
Heuristic: *does the process need it to start or to talk to itself?*

### 11. Persistence
SQLite-specific infrastructure. The single WAL-mode database, attempt store with PR/checkpoint history, per-issue config persistence, webhook delivery inbox, schema version tracking + migrations, write-audit log, observability snapshot persistence.
Heuristic: *is it a table, a migration, or a store?*
**Contrast with bundle 3 (Persistence / State)**, which is runtime state behavior.

## Decision tree for ambiguous features

When a feature fits ≥2 bundles, walk this tree in order. Stop at the first match.

1. **Does an operator directly interact with it in the browser?** → bundle 7 (Dashboard). Even if the code lives elsewhere, the *defining responsibility* is operator interaction.
2. **Is the principal symbol in `src/orchestrator/`?** → bundle 2 (Multi-Agent / Orchestration).
3. **Is it triggered by a pull request event or operates on one?** → bundle 4 (PR / CI).
4. **Does it execute inside a single attempt's turn loop?** → bundle 6 (Agent Runtime / Execution).
5. **Is it a SQLite store, table, schema, or migration?** → bundle 11 (Persistence).
6. **Does it encrypt, sign, gate, or authenticate?** → bundle 9 (Security / Auth).
7. **Does it deliver events outside Risoluto or accept them from outside?** → bundle 1 (Notifications, Chat & Triggers).
8. **Otherwise**, pick the bundle whose existing entries are most semantically related.

## When to create a new bundle

Only if **3+ unrelated new features** in a single run genuinely don't fit any existing bundle. Single odd-fit features go into the closest existing bundle with a note in `## Analyst notes` → `### Bundle-fit decisions made in this spine` explaining the call.

If you create a new bundle:
- Add it to the `bundles[]` top-level array in JSON.
- Place it in the markdown in the order that follows the existing flow (notifications → orchestration → state → PR → security → runtime → UI → config → security → runtime → persistence).
- Document the rationale in `## Analyst notes` → `### Bundle-fit decisions`.

## Recording bundle decisions

When a feature could plausibly land in two bundles and you chose one, add an entry under `analyst_notes.bundle_fit_decisions[]`:

```json
{ "bullet": "Self-review → PR / CI: called during attempt finalization (agent-runtime code location) but is a PR-quality feature, not a turn-loop concern.", "first_raised_sha": "cbf423b" }
```

That record is what stops the next run from re-bouncing the feature between bundles.
