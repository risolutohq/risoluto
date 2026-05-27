# Release Rules

> Versioning, CI requirements, and qualification gates for Risoluto. `0.1.0` is the curated import baseline; `0.x` is transition; `1.0.0` is the Foundation Baseline; SemVer applies after.

## Versioning Model

| Version    | Meaning                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `0.1.0`    | Curated backend/app snapshot. First repo history starts here. No old git history grafted.                       |
| `0.x`      | Foundation shaping. Spine surfaces are being built. Allowed: red / incomplete CI.                               |
| `1.0.0`    | **Foundation Baseline.** Coherent — every spine surface defined, key surfaces implemented, dogfood loop proven. |
| `>= 1.0.0` | Standard SemVer. Breaking changes bump `MAJOR`.                                                                 |

## `0.x` Allowances

- CI may be red on non-critical paths while spine surfaces land.
- Adapter implementations may be partial (Linear-first; others deferred).
- Live test coverage may grow incrementally.
- No backwards-compatibility commitments inside `0.x`.

## `1.0.0` Qualification — Foundation Baseline Checklist

All of the following must be true before tagging `v1.0.0`:

- [ ] Curated snapshot import complete; all kept source mapped to the current spine, capability backlog, decision register, or Linear.
- [ ] [Product Spine](./product-spine.md) written and current.
- [ ] [Technical Spine](./technical-spine.md) written and current.
- [ ] [Decisions Register](./decisions.md) created and current.
- [ ] Foundational ADRs created (see [adr/](./adr/)).
- [ ] [Capability Backlog](./capability-backlog.md) created and current.
- [ ] [Testing Strategy](./testing-strategy.md) written and current.
- [ ] [Release Rules](./release-rules.md) (this file) written and current.
- [ ] Clean `CHANGELOG.md` started from `0.1.0`.
- [ ] Meaningful CI green (unit + integration + mandatory PR live).
- [ ] Release live qualification passes (real tracker → Workflow Run → PR).
- [ ] No `TODO`-marked v1 blockers in code.
- [ ] Dogfood loop proven: at least one overnight-solo run delivers a mergeable PR without operator intervention.

## CI Requirements By Band

| Band       | Required                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.1.0`    | Snapshot tagged. CI may be red — this is the curated import baseline, not a working build.                                                        |
| `0.x`      | Build green by end of band. Critical paths green. PR live tests landing incrementally. Red CI acceptable while spine surfaces are being reshaped. |
| `1.0.0`    | All required CI green. Release live qualification passes.                                                                                         |
| `>= 1.0.0` | All required CI green per release. Release live qualification per release.                                                                        |

## Mandatory PR Live Tests

- Sandbox resources only (dedicated Linear team, dedicated GitHub repo, dedicated model account).
- `cheap-fast` model profile.
- Hard cost / token caps per PR.
- Blocking for merge once live test infra lands in `0.x`.

## Nightly Live Checks

- Broader coverage than PR live tests.
- Production-like profile.
- Failures page operator per alert tier policy (future; tracked in [capability backlog](./capability-backlog.md)).

## Release Live Qualification

- Full live workflow path: real Linear (or other tracker) item → real Workflow Run → real PR / MR.
- Strong-model profile coverage.
- Required for `1.0.0` and every subsequent SemVer release.

## Changelog Policy

- `CHANGELOG.md` starts clean from `0.1.0`. No old release history grafted.
- Entries follow Keep-a-Changelog format.
- Every release tag has a changelog entry.
- ADR-grade changes are linked from the changelog entry.

## Out of Scope For v1 Releases

- Hosted SaaS release cadence.
- Enterprise release channel.
- Plugin API stability commitments.

These activate when their respective capabilities ship out of the [capability backlog](./capability-backlog.md).
