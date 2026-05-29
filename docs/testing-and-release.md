# Testing & Release

> One doc for how Risoluto is tested and how it ships. `0.1.0` is the curated import baseline; `0.x`
> is foundation shaping; `1.0.0` is the Foundation Baseline; SemVer applies after. Merged from the
> former `testing-strategy.md` + `release-rules.md` — they were always read together.

## Versioning model

| Version    | Meaning                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `0.1.0`    | Curated backend/app snapshot. Repo history starts here; no old history grafted.                                 |
| `0.x`      | Foundation shaping. Spine surfaces are being built. Red / incomplete CI allowed.                                |
| `1.0.0`    | **Foundation Baseline.** Coherent — every spine surface defined, key surfaces implemented, dogfood loop proven. |
| `>= 1.0.0` | Standard SemVer. Breaking changes bump `MAJOR`.                                                                 |

`0.x` allowances: CI may be red on non-critical paths while spine surfaces land; adapter
implementations may be partial (Linear-first); live coverage grows incrementally; no
backwards-compatibility commitments inside `0.x`.

## `1.0.0` qualification — Foundation Baseline checklist

All must be true before tagging `v1.0.0`:

- [ ] Curated snapshot import complete; all kept source mapped to the current spine, [roadmap](./roadmap.md), [decisions](./decisions.md), or Linear.
- [ ] [Product Spine](./product-spine.md) written and current.
- [ ] [Technical Spine](./technical-spine.md) written and current.
- [ ] [Decisions Register](./decisions.md) current.
- [ ] Foundational ADRs current (see [adr/](./adr/)).
- [ ] [Roadmap](./roadmap.md) current.
- [ ] This **Testing & Release** doc current.
- [ ] Clean `CHANGELOG.md` started from `0.1.0`.
- [ ] Meaningful CI green (unit + integration + mandatory PR live).
- [ ] Release live qualification passes (real tracker → Workflow Run → PR).
- [ ] No `TODO`-marked v1 blockers in code.
- [ ] Dogfood loop proven: at least one overnight-solo run delivers a mergeable PR without operator intervention.

## CI requirements by band

| Band       | Required                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `0.1.0`    | Snapshot tagged. CI may be red — curated import baseline, not a working build.                            |
| `0.x`      | Build green by end of band. Critical paths green. PR live tests landing incrementally; red CI acceptable. |
| `1.0.0`    | All required CI green. Release live qualification passes.                                                 |
| `>= 1.0.0` | All required CI green per release. Release live qualification per release.                                |

## Test tiers

### Unit

Cover the contract surfaces of the spine. Bias: deterministic, fixture-based, fast. No network, no mocks-for-mocks-sake.

- Workflow Run lifecycle (transitions, gate evaluation, retry semantics).
- State machine + intra-state DAG resolution.
- Typed Artifact Contracts (validation, version compatibility).
- Event-sourced Run Log (projection, replay equivalence).
- Gates / Hooks / Transitions kept separate.
- Memory Builder + Memory Manager contracts (when implemented).

### Integration

Cover the **adapter contracts**, not the providers behind them. Bias: real adapters against fakes / containers where viable; live credential paths reserved for the live tier.

- Tracker adapter contract (Linear; a new tracker = same suite, different adapter).
- Harness adapter contract (Codex first).
- Persistence adapter (event log, artifact store, memory store).
- PR / MR adapter (GitHub).
- Tracker intake idempotency (webhook + polling cannot duplicate runs).

### Live

The integration tier verified against real third-party systems, in three sub-tiers:

- **Mandatory PR live tests.** Sandbox resources only (dedicated Linear team / GitHub repo / model account). `pr-live-smoke` profile. Hard cost / token caps per PR. Blocking for merge once live infra lands in `0.x`.
- **Nightly live checks.** Broader coverage; production-like profile; failures page the operator per alert-tier policy (future; [roadmap](./roadmap.md)).
- **Release live qualification.** Real tracker item → real Workflow Run → real PR / MR. `release-live` profile. Required before `1.0.0` and every subsequent SemVer release.

## Test model profiles

Tests select a **profile**, not a specific model. Profiles are central, versioned, tunable per environment:

- `pr-live-smoke` — PR live tests, smoke, idempotency.
- `release-live` — nightly and release qualification.
- `regression-frozen` — pinned models for deterministic regression catching.

## Changelog policy

- `CHANGELOG.md` starts clean from `0.1.0`; no old release history grafted.
- Keep-a-Changelog format; every release tag has an entry; ADR-grade changes are linked.

## Out of scope

Testing/release surfaces for excluded features (web frontend, plugin-API conformance, multi-tenant,
hosted-SaaS / enterprise release cadence) are out of scope for v1. The canonical out-of-scope list
lives in the [Product Spine](./product-spine.md#what-v1-does-not-implement); these activate when their
capability ships off the [roadmap](./roadmap.md).

## Related docs

- [Product Spine](./product-spine.md) / [Technical Spine](./technical-spine.md) — the surfaces under test.
- [Decisions](./decisions.md) + [ADRs](./adr/) — versioning and foundation decisions.
- [Roadmap](./roadmap.md) — what's queued.
