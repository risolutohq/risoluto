# Testing Strategy

> The shape of v1's test pyramid. Specifics (sandbox resources, cost caps, model profiles) are concretized in [release-rules.md](./release-rules.md) and per-suite config; this doc names the tiers and what each must cover.

## Tiers

### Unit

Cover the contract surfaces of the spine:

- Workflow Run lifecycle (transitions, gate evaluation, retry semantics).
- State machine + intra-state DAG resolution.
- Typed Artifact Contracts (validation, version compatibility).
- Event-sourced Run Log (projection, replay equivalence).
- Gates / Hooks / Transitions kept separate.
- Memory Builder + Memory Manager contracts (when implemented).

Bias: deterministic, fixture-based, fast. No network. No mocks-for-mocks-sake.

### Integration

Cover the **adapter contracts**, not the providers behind them:

- Tracker adapter contract (Linear; new tracker = same suite, different adapter).
- Harness adapter contract (Codex first).
- Persistence adapter (event log, artifact store, memory store).
- PR / MR adapter (GitHub).
- Tracker intake idempotency (webhook + polling cannot duplicate runs).

Bias: real adapters against fakes / containers where viable; live credential paths reserved for live tier.

### Live

The integration tier verified against real third-party systems. Three sub-tiers:

- **Mandatory PR live tests.** Sandbox resources only. Cheap / fast model profile. Strict cost / token caps. Dedicated Linear team / GitHub repo / model account.
- **Nightly live checks.** Broader coverage; full live workflow path on a recurring schedule.
- **Release live qualification.** Real tracker item → real Workflow Run → real PR / MR. Strong-model coverage. Required before `1.0.0` and any subsequent SemVer release.

## Test Model Profiles

Tests select a **profile**, not a specific model. Profiles are central, versioned, and tunable per environment:

- `cheap-fast` — PR live tests, smoke, idempotency.
- `production-like` — nightly, release qualification.
- `regression-frozen` — pinned models for deterministic regression catching.

## What v1 Allows During `0.x`

- Red / incomplete CI is acceptable while spine surfaces are being built.
- Live tests may be flaky against developing adapters; flakes are tracked, not ignored.

## What v1 Requires for `1.0.0`

- Green meaningful CI (unit + integration + mandatory PR live).
- Full live workflow path proven (release live qualification passes).
- See [release-rules.md](./release-rules.md) for the full checklist.

## Out of Scope For v1 Testing

- Web frontend test surface (no web frontend in v1).
- Plugin API conformance (no public plugin API in v1).
- Multi-tenant test surface (no tenancy in v1).
