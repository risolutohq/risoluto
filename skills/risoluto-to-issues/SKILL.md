---
name: risoluto-to-issues
description: Break a Risoluto PRD at `docs/prds/<slug>.md` into flat Linear Issues with blocked-by relations inferred by an LLM pass over the PRD body. Fork of `~/.claude/skills/to-issues/` — the generic skill stays tracker-agnostic; this one is Linear MCP only. Phase 4.1 of `docs/planning-pipeline-roadmap.md`. Use when Omer says `/risoluto-to-issues`, `/to-issues`, "break <slug> into issues", "create tickets from the <slug> PRD", or any variation that implies turning a PRD into Linear Issues.
---

# risoluto-to-issues

PRD-to-Linear-Issues breaker for the Risoluto planning pipeline. Phase 4.1 of the planning-pipeline roadmap. **Fork of `~/.claude/skills/to-issues/`** — keep the global skill generic, never edit it. Linear-specific behaviour and the flat-issue-with-blocked-by layout live here.

## What this skill produces

For one `<prd-slug>` per invocation:

1. An LLM-inferred slice graph: a set of vertical slices with dependency edges, extracted from the full PRD body (no explicit `## Slices` section required — the LLM reads the whole PRD).
2. Operator review of the proposed graph (accept, reject with feedback, or edit).
3. Flat Linear Issues created on the same Project as the PRD (resolved from `docs/prds/<slug>.md` frontmatter `linear_project`), with:
   - Linear "blocked-by" relations matching the approved dependency graph
   - Labels: `bundle:<category>` (from `capability-backlog.md` row), `tracer`, `slice:hitl` or `slice:afk`, `from:prd-<slug>`
   - Issue body following the template from the global `to-issues` skill (Parent, What to build, Acceptance criteria, Blocked by)
4. Issues published in dependency order (blockers first) so real identifiers can be used in "Blocked by" fields.

## Hard preconditions

Stop and report if any of these fail. Do **not** retry MCP auth from inside this skill — if Linear MCP errors, surface it to the operator.

| Check | Command / verification | If it fails |
|-------|----------------------|-------------|
| Run from repo root | `test -f package.json && test -f .gitmodules` | Tell Omer to `cd` into the `risoluto` checkout root. |
| `research/` initialised | `git submodule status research` starts with a space | Tell Omer to `git submodule update --init research`. |
| PRD exists | `test -f docs/prds/<slug>.md` | Tell Omer to run `/risoluto-to-prd <slug>` first. |
| PRD has `linear_project` | frontmatter `linear_project` is non-null | Tell Omer to run `/risoluto-to-prd <slug>` first. |
| Linear MCP responding | Any `mcp__linear-server__list_teams` call succeeds | Surface the MCP error verbatim; do not retry auth. |
| No existing `from:prd-<slug>` issues | `mcp__linear-server__list_issues` with label filter returns empty | Tell Omer issues already exist for this PRD; re-run would duplicate. |

## Pipeline

Two steps: **preload**, **extract + create**. The extract step (inferring the slice graph) happens in the agent's head; the deterministic script handles context gathering so the agent has everything it needs.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-to-issues/scripts/preload.mjs <prd-slug>
```

Stdout: JSON with slug, linear_project URL, PRD path, PRD body, source_idea path, category from capability-backlog.md, idea README path.

Stderr: one-line summary. Show Omer the summary.

Then read the PRD body in full — this is the material the LLM pass will extract slices from.

### Step 2 — Extract slices via LLM pass

Read the full PRD body and extract a proposed slice graph:

- Each slice: title, type (HITL/AFK), blocked-by (list of other slice titles), user stories covered
- Slices are vertical (tracer bullets) — each cuts through all layers end-to-end
- Prefer many thin slices over few thick ones
- Non-deterministic: the same PRD may produce different graphs on different runs

Present the proposed graph to Omer as a numbered list:

- **Title**: short name
- **Type**: HITL / AFK
- **Blocked by**: which other slices
- **User stories covered**: which PRD user stories this addresses

Ask Omer:

- Does the granularity feel right?
- Are the dependency relationships correct?
- Should any slices be merged or split?
- Are HITL/AFK assignments correct?

Iterate until Omer approves. If Omer rejects, re-run the inference with his feedback as additional context.

### Step 3 — Create Linear Issues

For each approved slice, in dependency order (blockers first):

1. Call `mcp__linear-server__create_issue` with:
   - `title`: slice title
   - `description`: issue body (using the template below)
   - `project`: the Linear Project ID from the PRD's `linear_project` frontmatter
   - `labels`: `["bundle:<category>", "tracer", "slice:hitl"|"slice:afk", "from:prd-<slug>"]`
   - `blockedBy`: Linear issue IDs of blocker slices (already created since we go in order)
2. Record the returned issue ID/URL for use in subsequent slices' `blockedBy`.

**Issue body template:**

```markdown
## Parent

PRD: [docs/prds/<slug>.md](<prd-linear-project-url>)

## What to build

[Concise description of this vertical slice. Describe end-to-end behavior, not layer-by-layer implementation. Avoid specific file paths or code snippets — they go stale fast.]

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

[References to blocking Linear issues, or "None - can start immediately"]
```

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists.
- **Linear MCP errors are operator concerns.** Surface verbatim, stop, do not retry.
- **The `from:prd-<slug>` label is load-bearing.** Phase 4.2's TDD skill uses it to find the linked PRD, and Phase 4.3's post-merge workflow uses it to trigger automation. Always apply it.
- **`bundle:<category>` comes from `capability-backlog.md`**, not from the PRD. The preload script extracts it.
- **Non-deterministic slice extraction is intentional.** The operator reviews and approves — the skill doesn't claim to produce the "correct" graph, just a reasonable starting point.
- **Issues are flat, not nested.** No parent-child hierarchy. Dependencies are expressed via `blocked-by` relations only.
- **Do NOT close or modify the Linear Project.** Issues are created under it; the Project stays open.

## Companion files

- `docs/planning-pipeline-roadmap.md` — Phase 4.1 spec
- `~/.claude/skills/to-issues/` — the generic upstream skill this forks from
- `skills/risoluto-to-prd/` — Phase 3.2; produces the PRD this skill consumes
- `skills/risoluto-tdd/` — Phase 4.2; picks up individual issues created by this skill
