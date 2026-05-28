# ADR-0007: Research-to-Shipping Planning Pipeline

- **Status:** Accepted
- **Date:** 2026-05-27

## Context

Risoluto's v1 planning surface evolved ad-hoc: research notes lived in Obsidian, ideas were tracked in a flat markdown backlog, and the path from "interesting cluster" to "shipped PR" required manual context-switching between tools, trackers, and documents. The operator needed a repeatable pipeline that:

1. Captures external research into a structured, greppable corpus.
2. Synthesizes clusters into discrete ideas with evidence trails.
3. Grills ideas into shippable shapes with product framing.
4. Produces PRDs canonical in git, mirrored to Linear Projects.
5. Breaks PRDs into Linear Issues with dependency graphs.
6. Drives TDD implementation per issue with automatic PR-to-ticket linking.
7. Flips PRD status on merge without manual bookkeeping.

The seam between planning and runtime is the **Linear ticket**, not the harness.

## Decision

Risoluto ships a five-phase planning pipeline as a set of composable skills and CI automations:

| Phase | Skill / Automation                      | Artifact                                              |
| ----- | --------------------------------------- | ----------------------------------------------------- |
| 1     | `risoluto-researcher`, `risoluto-vault` | `research/targets/<slug>/` + sources                  |
| 2     | `risoluto-synthesizer`                  | `research/ideas/<slug>/` + backlog row                |
| 3     | `risoluto-grill`, `risoluto-to-prd`     | Grilled idea + `docs/prds/<slug>.md` + Linear Project |
| 4     | `risoluto-to-issues`, `risoluto-tdd`    | Linear Issues + PRs with `from:prd-*` labels          |
| 5     | Post-merge workflow                     | PRD `status: shipped` + Linear back-comments          |

Key design decisions:

- **PRDs are canonical in git.** Linear Project descriptions are generated mirrors. A pre-push hook detects drift and blocks pushes when Linear has been edited outside git.
- **Flat issues with blocked-by relations.** No parent-child nesting. Dependencies expressed via Linear's blocked-by field.
- **LLM-inferred slice graphs.** The `to-issues` skill reads the full PRD body and extracts vertical slices non-deterministically. Operator reviews before issues are created.
- **Fork-not-upgrade rule.** Linear-specific behavior lives in `skills/risoluto-*`; global `~/.claude/skills/{to-prd,to-issues,tdd}` stay generic and reusable.
- **Manual `/tdd <ticket-ref>` now.** Runtime auto-pickup of Linear tickets is deferred behind the `auto:runtime` label seam.

The full design tree, resolved decisions table, and frontmatter contracts are recorded in [`docs/planning-pipeline-roadmap.md`](../planning-pipeline-roadmap.md) (now superseded by this ADR as the authoritative reference).

## Consequences

**Positive.** The path from raw research to merged PR is repeatable and auditable. Every artifact has a stable location and a frontmatter contract. The Linear ticket is the joint between planning and implementation — swapping trackers later means replacing an adapter, not rewriting the pipeline. PRD drift detection prevents silent canon divergence.

**Negative.** The pipeline is operator-driven, not automated. Each phase requires explicit invocation (`/risoluto-researcher`, `/risoluto-grill`, etc.). The LLM-inferred slice graph is non-deterministic — the same PRD may produce different issue graphs on different runs. The pre-push drift check requires `LINEAR_API_KEY` to be set, adding an environment dependency to `git push`.

**Neutral.** The `research/` submodule is a hard prerequisite for all pipeline work. The two-vault model (personal Obsidian vault + research submodule) is intentional separation, not a limitation.

## Alternatives Considered

- **Single-vault model (research in personal Obsidian).** Rejected: research artifacts are project-specific and should version with the repo, not in a personal knowledge base.
- **GitHub Issues instead of Linear.** Rejected: Linear's blocked-by relations, project descriptions, and GraphQL API are better suited for the pipeline's needs. GitHub Issues remains public intake / mirror only (Decision #6).
- **Deterministic YAML-based post-merge automation.** Rejected in favor of a Node.js script (`scripts/post-merge-prd.mjs`) because the second post-merge behavior amortizes the investment, and the runtime dogfood is part of the product story.
- **Nested sub-issues in Linear.** Rejected: flat issues with blocked-by relations are simpler, more portable, and avoid Linear's nested-issue UX limitations.
- **PRD canonical in Linear, mirrored to git.** Rejected: git is the durable, diffable, PR-reviewable source of truth. Linear is a projection.
