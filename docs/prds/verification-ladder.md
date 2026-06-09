---
slug: verification-ladder
linear_project: https://linear.app/ninetech/project/verification-ladder-e25bb1dd5a9d
synced_at: 2026-06-02T00:00:00Z
source: docs/roadmap.md#verification-ladder
status: shipped
---

## Problem Statement

Risoluto is built through its own research-to-shipping pipeline: a PRD becomes Linear issues, each
issue is implemented test-first, and "done" means the v1 gate is green (build, lint, format, test,
typecheck, type-coverage). That gate proves each module works _when something calls it_. It never
proves that anything actually calls it from a real intake adapter — CLI start, the HTTP webhook, or
Slack. So a capability can be fully implemented, fully tested, and merged as "done" while it is
reachable only from its own tests: an exported function with no production caller, or a production
caller that computes a result and discards it. A green check over unreachable code is an unshipped
feature wearing a check mark.

This already bit the workflow-first-afk-mvp build. All issues reached Done with a green gate and a
passing dogfood capstone, yet the workflow engine, the GitHub webhook intake, and inbound Slack were
never wired to a real intake — the capstone hand-composed modules with stubs and called internals
directly, bypassing the production path. The gap surfaced only through manual review and a large
corrective pass that restructured the executor across hundreds of lines after the fact, and one
keystone was confirmed reachable only after a deep live-debugging session. The cost is rework churn,
false "done," and eroded trust in the green gate. It is the class of gap a same-loop reviewer most
reliably misses.

The fix is not more unit tests and not a higher line-coverage number. Line coverage can reach 100%
entirely from tests that call internals directly, which would dress up this exact failure mode
without changing it. What is missing is a check on _reachability_: machine proof that each
load-bearing capability is invoked through a real intake adapter — enforced both while the agent
builds (so the gap is caught in-loop, before the corrective pass) and independently in CI (so a green
report can be trusted at all).

## Solution

Build a **verification ladder**: three layers of increasing fidelity that together prove a capability
is reachable from a real intake adapter and actually fires, plus dual enforcement so the proof is both
produced in-loop and enforced externally.

- **Layer 1 — Reachability gate (static, cheap, fast).** A committed capability manifest maps each
  load-bearing capability to its defining symbol and module and the intake adapter it must be
  reachable from. A reachability analyzer reads the import graph rooted at the intake-adapter entry
  modules, confirms the capability's module is in the reachable set, and confirms a non-test call site
  exists. A dead-export scan flags exports nothing imports. A thin `scripts/reachability-check.ts`
  runs the analyzer and exits non-zero on any gap, printing which capability is unreachable and the
  missing link.
- **Layer 2 — E2E intake tier (behavioral, non-gameable).** A small set of end-to-end tests drive a
  real intake adapter — CLI `run start` through argument parsing, a signed HTTP webhook request, a
  signed Slack request — faking only the true externals (the agent dispatcher, git, GitHub) and
  asserting the capability's observable effect (artifact deposited, handoff rendered, dispatch
  resolved, status transition recorded). A trivial fake production caller can satisfy the static gate
  but cannot satisfy an e2e that asserts behavior at the boundary; this layer is what makes
  reachability honest.
- **Layer 3 — Live smoke (release rung, gated on real spend).** The existing live-tier run that drives
  `run start` against the live sandbox repository with the real agent, run by hand at release and
  documented as the top rung — never a normal CI test.

Dual enforcement:

- **External.** `reach:check` and the e2e tier run in CI and in the v1 gate, so a merge cannot pass
  while a manifested capability is unreachable. The enforcement is independent of the agent's own
  claims, which is the entire point — the agent already reported green and was wrong.
- **In-loop.** The pipeline skills' definition of done is hardened so the agent must add the capability
  to the manifest, make `reach:check` green, and add or extend an e2e at the intake adapter before it
  ticks a Linear acceptance criterion. This catches the gap while the agent still has context and
  removes the after-the-fact corrective pass.

These are development-time and CI concerns operating on the Risoluto repository itself. They are named
deliberately to avoid collision with runtime Workflow Run concepts: the **reachability gate** is not
the product's **Validation Gate**, and reachability analysis is not the **Verifier** role. The ladder
answers "is this capability wired into Risoluto," never "did a Workflow Run satisfy its intent."

## User Stories

1. As a Risoluto maintainer, I want a machine check that each load-bearing capability is reachable from
   a real intake adapter, so that "tests pass" can no longer hide an unshipped feature.
2. As a Risoluto maintainer, I want the check to fail the build when a capability is exported but never
   called from a production path, so that exported-but-uncalled code cannot merge as "done."
3. As a Risoluto maintainer, I want a capability whose only callers live under `tests/` flagged as a
   gap, so that test-only wiring is caught.
4. As a Risoluto maintainer, I want the report to name the unreachable capability, the intake adapter
   it must reach, and the nearest reachable ancestor, so that I can fix the wiring instead of hunting
   for it.
5. As a manifest author, I want to declare a capability as its symbol, defining module, target intake
   adapter, and a one-line reason it is load-bearing, so that "the bar" is explicit and reviewable in
   git.
6. As a manifest author, I want a schema-validated manifest so a typo — an unknown intake adapter, a
   missing symbol — fails loudly at load, so that the manifest cannot silently rot.
7. As a Risoluto maintainer, I want reachability measured from the actual intake-adapter entry modules
   (the CLI command entry, the HTTP route registry, the Slack webhook route), so that it reflects where
   production really starts.
8. As a Risoluto maintainer, I want a complementary scan that surfaces fully-dead exports across the
   repo, so that dead code is visible separately from reachability gaps.
9. As a Risoluto maintainer, I want `reach:check` to run in seconds with no new dependency, so that I
   can put it in the v1 gate without slowing it meaningfully.
10. As a Risoluto maintainer, I want `reach:check` to exit non-zero with a diff-friendly summary, so
    that CI fails cleanly and the log says exactly what is unreachable.
11. As a Risoluto maintainer, I want an e2e test that drives CLI `run start` through argument parsing
    and asserts the capability's artifact or handoff effect, so that reachability is proven
    behaviorally, not just structurally.
12. As a Risoluto maintainer, I want an e2e test that sends a signed request to the real HTTP webhook
    and asserts a run is created and driven, so that HTTP intake reachability is proven the way a
    provider would exercise it.
13. As a Risoluto maintainer, I want an e2e test that sends a signed Slack request through the real
    route and asserts the modal or approval effect, so that Slack intake reachability is proven.
14. As a Risoluto maintainer, I want e2e tests to fake only the true externals (agent dispatcher, git,
    GitHub) and keep the intake-to-engine path real, so that the test fails if the wiring is missing
    even when every unit passes.
15. As a Risoluto maintainer, I want the e2e tier to catch a capability whose result is computed and
    then discarded, so that reachability theater is caught where static analysis cannot see it.
16. As a Risoluto maintainer, I want a reusable e2e harness that composes the faked external boundary
    once, so that adding an e2e per capability is cheap.
17. As a Risoluto maintainer, I want the e2e tier to run under its own command and config, so that it
    can gate CI without bloating the unit suite.
18. As a Risoluto maintainer, I want the live `run start` → real agent → draft PR run documented as the
    ladder's top rung, so that the highest-fidelity proof has a home and is run by hand at release.
19. As a Risoluto maintainer, I want the live smoke gated behind explicit opt-in and never run in
    normal CI, so that real token spend stays deliberate.
20. As a Risoluto maintainer, I want `reach:check` and the e2e tier wired into the v1 gate and CI, so
    that green can be trusted because reachability is enforced independently of any agent's claim.
21. As a Risoluto maintainer, I want a reachability gap to fail the gate at the same severity as a
    failing test, so that the bar is not advisory.
22. As a pipeline agent, I want my definition of done to require adding the new capability to the
    manifest and making `reach:check` green before I tick a Linear acceptance criterion, so that I
    catch the gap while I still have context.
23. As a pipeline agent, I want my definition of done to require adding or extending an e2e at the
    intake adapter for the capability I built, so that behavioral reachability is part of "done," not a
    follow-up.
24. As a reviewer, I want the review-handoff lens to independently confirm the manifest entry and e2e
    for each shipped capability, so that a different model confirms reachability before merge.
25. As a Risoluto maintainer, I want the issue-breakdown step to attach a reachability acceptance
    criterion to every capability-bearing slice, so that issues carry the bar from the start.
26. As a pipeline agent, I want a genuinely deferred capability recorded as an explicit manifest entry
    marked deferred with a reason, rather than omitted, so that deferral is honest and visible instead
    of silent.
27. As a Risoluto maintainer, I want one command that lists every manifested capability with its
    current reachability verdict, so that I can audit the whole repo's honest state in one shot.
28. As a Risoluto maintainer, I want the first `reach:check` run to audit the current branch's
    capabilities, so that I learn immediately which past "done" tickets are actually reachable.
29. As a Risoluto maintainer, I want the report to distinguish "module not reachable" from "module
    reachable but no non-test caller" from "dead export," so that I know which kind of gap I am fixing.
30. As a Risoluto maintainer, I want the tooling to follow the repo's existing script and library
    conventions (a thin tsx entry over a tested source module), so that it is maintainable like the
    rest of the codebase.
31. As a Risoluto maintainer, I want the reachability tooling named so it cannot be confused with the
    runtime Verifier role or Validation Gate, so that the dev-time check and the product concept stay
    distinct.
32. As a Risoluto maintainer, I want the ladder to add no new runtime dependency and to respect the
    lint ceilings, so that the verification tooling does not itself become tech debt.

## Implementation Decisions

- The verification ladder is a development-time and CI capability that operates on the Risoluto
  repository. It is explicitly not a runtime Workflow Run concept: the **reachability gate** is
  distinct from the product's **Validation Gate**, and reachability analysis is distinct from the
  **Verifier** role. Naming keeps these separate in code and docs.
- The ladder has three layers — (1) static reachability gate, (2) e2e intake tier, (3) live smoke —
  and dual enforcement — external (CI plus the v1 gate) and in-loop (pipeline-skill definition of done).
- The reachability mechanism is **hybrid**: module-graph reachability via `madge` (already a
  dependency, so no new dependency) computed from the intake-adapter entry modules, plus a non-test
  call-site check for each capability. `knip` (already a dependency) provides a complementary
  fully-dead-export scan. Full call-graph static analysis via `ts-morph` is rejected for this work — it
  adds a dependency, is slower, and risks the complexity ceiling; the e2e layer covers the precision
  gap (import is not call; result-discarded) instead.
- The intake-adapter entry modules are the production roots reachability is measured from: the CLI
  command entry, the HTTP route registry, and the Slack webhook route. The manifest names which
  adapter each capability must reach.
- Three deep modules carry the work:
  - **Reachability analyzer** — a small, stable interface: given the entry roots and the parsed
    manifest, return a verdict per capability — `reachable` with its caller chain, or a gap with a
    typed reason (`module-unreachable`, `no-nontest-caller`, or `dead-export`). The graph provider
    (the `madge` invocation) is injected behind a port so the verdict logic is pure and unit-testable
    against fixture graphs with no real filesystem.
  - **Capability manifest loader** — a schema-validated loader that produces typed capability records
    and rejects unknown intake-adapter ids, missing symbols, or malformed entries at load.
  - **E2E intake harness** — composes the faked external boundary (agent dispatcher, git, GitHub) once
    and boots a real intake adapter, exposing assertions over archived artifacts and events; reused
    across e2e tests.
- `scripts/reachability-check.ts` follows the repo's self-contained script pattern: a JSDoc header
  documenting purpose, exit codes, and env; `REPO_ROOT` derived from the module URL; output to stderr;
  `process.exit(1)` on a gap. All analysis logic lives in the injected source deep module, keeping the
  script thin.
- The manifest is a committed file; each entry carries the capability name, the load-bearing symbol,
  its defining module, the intake adapter(s) it must be reachable from, a one-line reason it is
  load-bearing, and an optional `deferred` flag with a reason. The manifest is the single source of
  "the bar."
- A reachability gap fails `reach:check` at the same severity as a failing test. Deferred capabilities
  are explicit manifest entries with a reason, never omissions; the analyzer reports them as deferred
  rather than as silent passes.
- CI and gate wiring: add `reach:check` and `test:e2e` scripts; insert `reach:check` into the v1 gate
  sequence as a fast read-only step and add both `reach:check` and the e2e tier to CI. The e2e tier
  gets its own vitest config alongside the integration config so it gates CI without bloating the unit
  suite.
- In-loop enforcement edits the in-repo pipeline skills: the TDD skill (add the manifest entry, make
  `reach:check` green, and add an e2e before ticking a criterion), the issue-breakdown skill (a
  reachability acceptance criterion per capability-bearing slice), and the review-handoff lens
  (independently confirm the manifest entry and e2e). These edits encode the bar already proven by hand
  during the workflow-first-afk-mvp build.
- No new runtime dependency is added; `madge`, `knip`, and `vitest` are already present. The lint
  ceiling (complexity 15 per function) applies; the analyzer is split into the
  deep module plus a thin script to stay under it.
- The first `reach:check` run doubles as a retroactive audit of the current branch's capabilities; its
  output seeds the initial manifest and reveals which already-"Done" tickets are genuinely reachable.

## Testing Decisions

- Tests validate external behavior and contracts, not private implementation details. Prior art: the
  `run-start-*.integration.test.ts` family (drive a CLI command with an injected external boundary,
  then assert archived artifacts and events) and the script-driven checks (`live-preflight`,
  `prd-reconcile`).
- **Reachability analyzer** is tested with unit tests over fixture import-graphs and fixture manifests:
  a wired capability returns `reachable` with the caller chain; an exported-but-uncalled capability
  returns `no-nontest-caller`; a capability reachable only from `tests/` returns the test-only gap; an
  unimported module returns `module-unreachable`; a dead export is flagged. The injected graph provider
  keeps these pure and fast — no real filesystem and no `madge` subprocess.
- **Capability manifest loader** is tested with schema-validation cases: a valid manifest loads to
  typed records; a malformed entry (unknown intake adapter, missing symbol, bad module path, missing
  reason) is rejected with a clear, attributable error.
- **E2E intake harness**: the e2e tests are themselves the deliverable. At least one per intake adapter
  — CLI `run start`, a signed HTTP webhook request, a signed Slack request — drives the real adapter,
  fakes only the true externals, and asserts the capability's observable effect. A negative test proves
  the harness fails when the wiring is removed, guarding against a vacuous green.
- **Live smoke** is documented and kept as the existing gated live-tier run against the sandbox
  repository; it is not run in CI. The PRD records it as the ladder's top rung so the manifest can
  reference it, but it is exercised by hand at release.
- The reachability gate and e2e tier must themselves be reachable: `reach:check` is wired into the v1
  gate and CI (it is its own first customer), and the e2e config runs in CI.

## Out of Scope

- A line-coverage target, including 100%. Line coverage measures executed lines, not reachability from
  an intake adapter, and would mask the failure mode this PRD exists to catch. It is explicitly not
  adopted as the metric.
- Mutation testing. `@stryker-mutator/vitest-runner` is already a dependency and is the honest "are the
  tests meaningful" metric, but wiring a mutation-testing gate is a separate initiative, not part of
  this ladder.
- Any change to the runtime product Verifier role, Validation Gates, or validation profiles. This work
  touches only repo-CI tooling and pipeline-skill definition of done.
- Fixing the in-container agent-exec infrastructure issue that currently blocks the live smoke from
  opening a draft PR. The live rung is documented here, but unblocking it is owned by the
  workflow-first-afk-mvp live work.
- An exhaustive enumeration of every export as a capability. The manifest covers load-bearing,
  intake-reachable capabilities; ordinary internal helpers are not manifest entries.
- `ts-morph` or full call-graph static analysis, and any new runtime dependency.
- Frontend, dashboard, or docs-site surfaces.

## Further Notes

- Thinnest build order: (1) capability manifest, schema, and loader; (2) reachability analyzer deep
  module plus the `reach:check` script, seeded by an audit of the current branch; (3) wire `reach:check`
  into the v1 gate and CI; (4) e2e intake harness plus one e2e per adapter and a `test:e2e` config in
  CI; (5) in-loop definition-of-done edits to the pipeline skills; (6) document the live smoke rung.
- Prefer deep modules with small interfaces — the analyzer behind an injected graph provider, the
  manifest loader, the e2e harness — so each is testable in isolation and the thin script and CI wiring
  stay trivial.
- This PRD operationalizes the bar recorded during the workflow-first-afk-mvp build: a green gate over
  an exported-but-uncalled function is an unshipped feature wearing a check mark. The manual
  `rg -n "<symbol>" src --glob '!*.test.ts'` probe used there becomes the automated, manifest-driven
  gate.
- The first audit will likely reveal existing capabilities reachable only from tests; closing those is
  follow-up work surfaced by the gate, not part of building the gate itself.
- The Linear project mirror for this PRD is generated from git. Git remains the canonical PRD source.
