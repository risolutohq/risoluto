# ADR-0006: Environment-Portable Control Plane / Execution Plane Split

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Risoluto's v1 product is **single-node self-hosted** — operator's machine runs everything. But the long-term shape includes **enterprise-owned** (customer runs execution, optionally consumes a hosted control plane) and **hosted SaaS** (Risoluto runs control plane, customer runs execution). Hard-coding "control plane and execution plane live on one host" into v1 closes those doors expensively.

## Decision

Risoluto's architecture **separates the control plane from the execution / data plane** from v1 onward.

- **Control plane** owns: Workflow Run identity, scheduling, Workflow Definitions, observability aggregation, operator surfaces (CLI / TUI / HTTP).
- **Execution plane** owns: Role Execution, harness lifecycle, model / provider credentials, raw evidence, secret material.
- v1 default deployment runs both planes on the operator's machine — but the **interface between them is a network-shaped contract**, not in-process function calls.
- Secrets and model credentials **resolve in the execution plane** by default. Tracker credential placement is **policy-based** (enterprise default: local / customer-controlled).
- Raw evidence locality is policy-controlled (default: execution plane local; export goes through redaction).

## Consequences

**Positive.** Enterprise and SaaS modes become deployment / configuration problems, not refactors. Security posture (secrets live with the executor, not the orchestrator) is correct from the start. Operator can later split planes onto two machines without code change.

**Negative.** Even in single-node mode, the interface between planes is doing real work (serialization, identity, auth). Slightly more code than a tightly-coupled monolith. Initial v1 cost is paid for a future option.

**Neutral.** Operator running both planes on one machine sees no functional difference — the seam is invisible at the surface.

## Alternatives Considered

- **Tightly couple v1; refactor when SaaS / enterprise demand lands.** Rejected: refactoring distributed seams retroactively is expensive and risky; v1's surface area would be re-shaped by the refactor.
- **Build SaaS-shaped from day one.** Rejected: complexity without justification; no customer demand to ground the split's specifics.
- **Process-level isolation only (single host, two processes, IPC).** Rejected: doesn't prove network-shape correctness; bakes localhost assumptions that bite later.
