---
name: risoluto-tdd
description: Risoluto-repo Linear-aware TDD skill — the namespaced variant of the global tdd skill. Use when Omer says `/risoluto-tdd` or any variation that implies test-driven implementation of a specific Linear issue in the Risoluto planning pipeline (e.g. "implement ticket RSL-123", "TDD this issue"). Do NOT trigger on bare `/tdd` without a ticket ref; that may belong to the global tdd skill. Accepts a `<ticket-ref>` (e.g. `RSL-123`), fetches the issue + linked PRD via Linear MCP, validates upstream blocked-by tickets are Done, prepares an isolated git worktree from the PRD integration branch, claims the ticket (sets it In Progress), files out-of-scope discoveries as their own Linear issues, then delegates the red-green-refactor loop substeps to the global `~/.claude/skills/tdd/` skill. On PR ready, pushes the ticket branch for merge into the integration branch, back-comments the Linear ticket with the PR URL, and applies the `from:prd-<slug>` label — but PRINTS the `gh pr create` command for Omer to run; never executes it. Fork of `~/.claude/skills/tdd/` — the generic skill stays tracker-agnostic; this one is Linear-aware. Phase 4.2 of `docs/research-to-shipping-pipeline.md`.
---

# risoluto-tdd

Linear-aware TDD for the Risoluto planning pipeline. Phase 4.2. **Fork of `~/.claude/skills/tdd/`** — keep the global skill generic, never edit it. Linear-specific behaviour lives here.

## What this skill does

Given a `<ticket-ref>` (e.g. `RSL-123`):

1. Fetches the Linear issue via MCP — title, description, labels, blocked-by relations.
2. Resolves the linked PRD from the issue's `from:prd-<slug>` label → reads `docs/prds/<slug>.md` from disk.
3. Validates all upstream blocked-by tickets are status: Done. If any are not, refuses and lists the open blockers.
4. Creates an isolated git worktree from the PRD integration branch, then claims the ticket by setting it In Progress. Two parallel `/risoluto-tdd` runs from a `risoluto-next-bundle` plan never share a working tree.
5. Runs the TDD red-green-refactor loop (see [tests.md](tests.md), [mocking.md](mocking.md), [deep-modules.md](deep-modules.md), [interface-design.md](interface-design.md), [refactoring.md](refactoring.md)) guided by the issue's acceptance criteria and the PRD's implementation decisions. Out-of-scope work found mid-implementation is filed as its own Linear issue, not fixed inline.
6. On PR open:
   - Back-comments the Linear ticket with the PR URL.
   - Applies the `from:prd-<slug>` label to the PR (so Phase 4.3's post-merge workflow can find it).

## Hard preconditions

| Check                           | Command / verification                             | If it fails                                                                        |
| ------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Run from repo root              | `test -f package.json && test -f .gitmodules`      | Tell Omer to `cd` into the `risoluto` checkout root.                               |
| Linear MCP responding           | Any `mcp__linear-server__list_teams` call succeeds | Surface the MCP error verbatim; do not retry auth.                                 |
| Ticket ref provided             | argv has a ticket ref matching `[A-Z]+-\d+`        | Ask Omer for the Linear ticket ref.                                                |
| Issue exists in Linear          | `mcp__linear-server__get_issue` succeeds           | Surface the error — issue may not exist or ref may be wrong.                       |
| Issue has `from:prd-*` label    | Issue labels include `from:prd-<slug>`             | Tell Omer the issue wasn't created by `/risoluto-to-issues` — no linked PRD found. |
| PRD exists on disk              | `test -f docs/prds/<slug>.md`                      | Tell Omer the PRD file is missing — may need to run `/risoluto-to-prd`.            |
| All blocked-by tickets are Done | Each blocked-by relation has status "Done"         | List the open blockers and tell Omer to complete them first.                       |
| Working tree clean              | `git status --porcelain` empty (at relevant paths) | Tell Omer to commit or stash before starting.                                      |

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

### Step 2.5 — Set up an isolated worktree and claim the ticket

With the blockers confirmed Done, prepare isolation first, then claim the ticket before writing any code.

**Use the PRD integration branch.** Work for this PRD merges into `integration/<prd-slug>` first, then Codex reviews the finished integration branch. If the integration branch does not exist yet, create it from the latest default branch and push it before ticket work starts. Ticket branches branch from the integration branch and PR back into it, not directly into `master`.

**Isolate it.** `risoluto-next-bundle` proposes bundles meant to run as parallel worktrees holding _disjoint_ file regions — which only holds if each run gets its own worktree. Two runs in one working tree collide on the index and on uncommitted files. Create one off the latest integration branch:

```bash
git fetch origin
git worktree add .claude/worktrees/<ticket-ref-lower> -b feat/<ticket-ref-lower>-<slug> origin/integration/<prd-slug>
cd .claude/worktrees/<ticket-ref-lower>
# Secrets are not in git — symlink what the live/integration suites read:
ln -s "<main-repo-root>/.env.live.local" .env.live.local 2>/dev/null || true
```

`<slug>` is a short kebab form of the issue title. A worktree does **not** carry the `research/` submodule — if this slice touches `research/`, run `git submodule update --init research` inside it.

**Claim it.** After the worktree exists, set the ticket to In Progress via `mcp__linear-server__save_issue`. No confirmation — picking up a ticket _is_ starting it. This is the lock the parallel/AFK model relies on: `risoluto-next-bundle` only offers issues that are not already In Progress, so an unclaimed ticket can be double-started by a second worktree. Claiming closes that race. If the Linear claim succeeds but a later setup step fails, restore the prior Linear state or leave a Linear comment explaining the failed claim before stopping.

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

### Step 4.5 — File out-of-scope discoveries as their own issues

While implementing you will trip over things that are real but _not this slice_ — a latent bug, tech debt, a missing capability. Fixing them inline bloats the diff and muddies the red-green story, so file each as its own Linear issue with enough provenance to act on later, via `mcp__linear-server__save_issue`:

- **title**: `Found during <ticket-ref>: <short description>`
- **description**: what it is, why it matters, where (`path/to/file.ts:line`), and "discovered while implementing `<ticket-ref>`"
- **project**: the same Linear project as this ticket
- **labels**: `from:prd-<slug>` (same PRD lineage) plus `discovered` — create the `discovered` label once if missing (`mcp__linear-server__create_issue_label`, short description, grey)

Track every follow-up in your final summary so nothing silently drops. This is distinct from the PRD's **Out of Scope** boundary (see Notes): a deliberate PRD exclusion is a conflict to raise with Omer, not an issue to file.

### Step 5 — Open PR and link to Linear

When implementation is complete and all tests pass:

1. You are already on `feat/<ticket-ref-lower>-<slug>` inside the worktree from Step 2.5 — no new branch needed.
2. Commit with a conventional commit message referencing the ticket.
3. Push the branch. **Print** the `gh pr create` command for Omer to run, targeting `integration/<prd-slug>` — **do NOT execute `gh pr create`.**
4. Apply the `from:prd-<slug>` label to the PR via `gh pr edit --add-label from:prd-<slug>` (only after Omer has opened the PR)
5. Back-comment the Linear ticket with the PR URL via `mcp__linear-server__save_comment` (`issueId` + `body`, only after the PR exists)

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists.
- **Linear MCP errors are operator concerns.** Surface verbatim, stop, do not retry.
- **The `from:prd-<slug>` label on the PR is load-bearing.** Phase 4.3's post-merge workflow triggers on it. Always apply it.
- **Do not skip the blocked-by validation.** The dependency graph exists for a reason — implementing out of order produces integration failures.
- **The TDD supplementary files in this directory are authoritative** for test philosophy and patterns. They are identical to `~/.claude/skills/tdd/` — the TDD philosophy doesn't change, only the Linear integration is added.
- **PRD Out of Scope is a hard boundary.** If the issue's acceptance criteria seem to require something the PRD explicitly scopes out, surface the conflict to Omer rather than implementing it.
- **Work in a worktree, never in-place.** `risoluto-next-bundle`'s disjoint-locality reasoning only pays off if bundled slices run as parallel worktrees; implementing in the main checkout forfeits that and risks index collisions with a sibling run.
- **Merge ticket branches into the integration branch first.** For this PRD, the reviewable branch is `integration/<prd-slug>`; ticket PRs target that branch, and Codex reviews the finished integration branch after Claude/Codex workers have merged their slices.
- **Claiming (In Progress) is not optional and not confirmed** — it is the lock that stops two parallel runs from grabbing the same ticket. Leave the ticket In Progress at PR-open; moving it to Done is the operator's call after merge (Phase 4.3), never the skill's.
- **Filed discoveries vs. the Out-of-Scope boundary.** Incidental finds become `discovered` issues (Step 4.5); things the PRD deliberately excludes are surfaced to Omer, not filed.

## Companion files

- `docs/research-to-shipping-pipeline.md` — Phase 4.2 spec
- `~/.claude/skills/tdd/` — the generic upstream skill this forks from
- `skills/risoluto-to-issues/` — Phase 4.1; creates the Linear issues this skill implements
- `skills/risoluto-to-prd/` — Phase 3.2; produces the PRD this skill references
- `.github/workflows/post-merge.yml` — Phase 4.3; triggers on the `from:prd-*` label this skill applies
