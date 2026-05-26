---
name: risoluto-tdd
description: Test-driven development for a specific Linear issue in the Risoluto planning pipeline. Accepts a `<ticket-ref>` (e.g. `RSL-123`), fetches the issue + linked PRD via Linear MCP, validates upstream blocked-by tickets are Done, then runs the red-green-refactor TDD loop from `~/.claude/skills/tdd/`. On PR open, back-comments the Linear ticket with the PR URL and applies the `from:prd-<slug>` label to the PR so the post-merge workflow (Phase 4.3) can find the linked PRD. Fork of `~/.claude/skills/tdd/` — the generic skill stays tracker-agnostic; this one is Linear-aware. Phase 4.2 of `docs/planning-pipeline-roadmap.md`. Use when Omer says `/risoluto-tdd`, `/tdd <ticket-ref>`, "implement ticket RSL-123", "TDD this issue", or any variation that implies test-driven implementation of a Linear issue.
---

# risoluto-tdd

Linear-aware TDD for the Risoluto planning pipeline. Phase 4.2. **Fork of `~/.claude/skills/tdd/`** — keep the global skill generic, never edit it. Linear-specific behaviour lives here.

## What this skill does

Given a `<ticket-ref>` (e.g. `RSL-123`):

1. Fetches the Linear issue via MCP — title, description, labels, blocked-by relations.
2. Resolves the linked PRD from the issue's `from:prd-<slug>` label → reads `docs/prds/<slug>.md` from disk.
3. Validates all upstream blocked-by tickets are status: Done. If any are not, refuses and lists the open blockers.
4. Runs the TDD red-green-refactor loop (see [tests.md](tests.md), [mocking.md](mocking.md), [deep-modules.md](deep-modules.md), [interface-design.md](interface-design.md), [refactoring.md](refactoring.md)) guided by the issue's acceptance criteria and the PRD's implementation decisions.
5. On PR open:
   - Back-comments the Linear ticket with the PR URL.
   - Applies the `from:prd-<slug>` label to the PR (so Phase 4.3's post-merge workflow can find it).

## Hard preconditions

| Check | Command / verification | If it fails |
|-------|----------------------|-------------|
| Run from repo root | `test -f package.json && test -f .gitmodules` | Tell Omer to `cd` into the `risoluto` checkout root. |
| Linear MCP responding | Any `mcp__linear-server__list_teams` call succeeds | Surface the MCP error verbatim; do not retry auth. |
| Ticket ref provided | argv has a ticket ref matching `[A-Z]+-\d+` | Ask Omer for the Linear ticket ref. |
| Issue exists in Linear | `mcp__linear-server__get_issue` succeeds | Surface the error — issue may not exist or ref may be wrong. |
| Issue has `from:prd-*` label | Issue labels include `from:prd-<slug>` | Tell Omer the issue wasn't created by `/risoluto-to-issues` — no linked PRD found. |
| PRD exists on disk | `test -f docs/prds/<slug>.md` | Tell Omer the PRD file is missing — may need to run `/risoluto-to-prd`. |
| All blocked-by tickets are Done | Each blocked-by relation has status "Done" | List the open blockers and tell Omer to complete them first. |
| Working tree clean | `git status --porcelain` empty (at relevant paths) | Tell Omer to commit or stash before starting. |

## Pipeline

### Step 1 — Fetch the Linear issue

Call `mcp__linear-server__get_issue` (or equivalent) with the ticket ref. Extract:
- Title, description (the "What to build" + acceptance criteria)
- Labels (find `from:prd-<slug>` to resolve the PRD)
- Blocked-by relations (list of issue IDs)

### Step 2 — Validate blocked-by tickets

For each blocked-by relation, fetch the issue and check its status. If any are not "Done":
- List each open blocker: `[RSL-456] Implement provider interface — status: In Progress`
- Refuse to proceed: "Complete the blockers first, then re-run `/risoluto-tdd <ticket-ref>`."

### Step 3 — Read the linked PRD

From the `from:prd-<slug>` label, read `docs/prds/<slug>.md`. The PRD's:
- **Implementation Decisions** section guides architectural choices
- **Testing Decisions** section guides what to test and how
- **User Stories** inform acceptance criteria beyond what the issue itself lists
- **Out of Scope** section prevents over-implementation

### Step 4 — TDD red-green-refactor loop

Follow the TDD workflow from `~/.claude/skills/tdd/SKILL.md` (the philosophy, anti-patterns, and workflow steps are authoritative — read the supplementary files in this skill directory for details):

1. **Planning** — confirm interface with Omer, identify behaviors to test, get approval
2. **Tracer bullet** — one test → one implementation → proves the path
3. **Incremental loop** — RED → GREEN, one test at a time
4. **Refactor** — after all tests pass, extract duplication, deepen modules

Key constraints from the PRD:
- Use the project's domain glossary so test names match Risoluto's vocabulary
- Respect ADRs in the area being touched
- Tests go in the project's existing test tiers (`vitest.config.ts` for unit, `vitest.integration.config.ts` for integration)

### Step 5 — Open PR and link to Linear

When implementation is complete and all tests pass:

1. Create a feature branch: `feat/<ticket-ref-lowercase>-<short-description>`
2. Commit with conventional commit message referencing the ticket
3. Push and open a PR (or print the `gh pr create` command for Omer to run)
4. Apply the `from:prd-<slug>` label to the PR via `gh pr edit --add-label from:prd-<slug>`
5. Back-comment the Linear ticket with the PR URL via `mcp__linear-server__add_comment`

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists.
- **Linear MCP errors are operator concerns.** Surface verbatim, stop, do not retry.
- **The `from:prd-<slug>` label on the PR is load-bearing.** Phase 4.3's post-merge workflow triggers on it. Always apply it.
- **Do not skip the blocked-by validation.** The dependency graph exists for a reason — implementing out of order produces integration failures.
- **The TDD supplementary files in this directory are authoritative** for test philosophy and patterns. They are identical to `~/.claude/skills/tdd/` — the TDD philosophy doesn't change, only the Linear integration is added.
- **PRD Out of Scope is a hard boundary.** If the issue's acceptance criteria seem to require something the PRD explicitly scopes out, surface the conflict to Omer rather than implementing it.

## Companion files

- `docs/planning-pipeline-roadmap.md` — Phase 4.2 spec
- `~/.claude/skills/tdd/` — the generic upstream skill this forks from
- `skills/risoluto-to-issues/` — Phase 4.1; creates the Linear issues this skill implements
- `skills/risoluto-to-prd/` — Phase 3.2; produces the PRD this skill references
- `.github/workflows/post-merge.yml` — Phase 4.3; triggers on the `from:prd-*` label this skill applies
