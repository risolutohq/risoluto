---
name: risoluto-tdd
description: Risoluto-repo Linear-aware TDD skill — the namespaced variant of the global tdd skill. Use when Omer says `/risoluto-tdd` or implies test-driven implementation of a specific Linear ticket in the Risoluto pipeline (e.g. "implement ticket RSL-123", "TDD this issue"). Do NOT trigger on bare `/tdd` without a ticket ref — that may belong to the global tdd skill. Takes a `<ticket-ref>`, fetches the issue + linked PRD, refuses unless upstream blocked-by tickets are Done, works in an isolated git worktree, claims the ticket, runs the red-green-refactor loop from this skill's bundled companion files, then on PR-ready back-comments the ticket, ticks each acceptance criterion it can prove, and prints (never runs) `gh pr create`. Stage 3 of `docs/research-to-shipping-pipeline.md`.
---

# risoluto-tdd

Linear-aware TDD for the Risoluto pipeline. Stage 3. Forked from the generic global `tdd` skill — keep that one tracker-agnostic, never edit it; the Linear-specific behaviour and the bundled TDD companion files live here.

> **Linear access (agent-portable).** This skill names Linear **operations**, not a fixed tool. Bind each operation to whatever Linear surface your agent has: under **Claude**, the Linear MCP tools (`mcp__linear-server__<op>` — e.g. `get_issue`, `save_issue`, `save_comment`, `create_issue_label`, `list_teams`); under **Codex** or any agent without the Linear MCP, `LINEAR_API_KEY` + the Linear GraphQL API — see [`../references/linear-access.md`](../references/linear-access.md) for ready-to-run queries for every operation this skill uses (that file owns all Linear mutations, project- and issue-level). `.codex/config.toml` ships no Linear MCP, so GraphQL is the Codex path. If neither surface is reachable, surface the error verbatim and stop — never retry auth.

## What this skill does

Given a `<ticket-ref>` (e.g. `RSL-123`):

1. Fetches the Linear issue — title, description, labels, blocked-by relations.
2. Resolves the linked PRD from the issue's `from:prd-<slug>` label → reads `docs/prds/<slug>.md` from disk.
3. Validates all upstream blocked-by tickets are status: Done. If any are not, refuses and lists the open blockers.
4. Creates an isolated git worktree from the PRD integration branch, then claims the ticket by setting it In Progress. Two parallel `/risoluto-tdd` runs from a `risoluto-next-bundle` plan never share a working tree.
5. Runs the TDD red-green-refactor loop (see [tests.md](../references/coder-discipline/tests.md), [mocking.md](../references/coder-discipline/mocking.md), [deep-modules.md](../references/coder-discipline/deep-modules.md), [interface-design.md](../references/coder-discipline/interface-design.md), [refactoring.md](../references/coder-discipline/refactoring.md)) guided by the issue's acceptance criteria and the PRD's implementation decisions. Out-of-scope work found mid-implementation is filed as its own Linear issue, not fixed inline.
6. On PR open:
   - Back-comments the Linear ticket with the PR URL.
   - Applies the `from:prd-<slug>` label to the PR (so Stage 4's post-merge workflow can find it).
   - Reconciles the issue's acceptance criteria: ticks each box the slice actually proved (citing the test or entry point that closes it) and leaves any deferred or unmet criterion unchecked with a one-line reason.

## Hard preconditions

| Check                           | Command / verification                                   | If it fails                                                                        |
| ------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Run from repo root              | `test -f package.json && test -f .gitmodules`            | Tell Omer to `cd` into the `risoluto` checkout root.                               |
| Linear reachable                | A Linear connectivity probe succeeds (see Linear access) | Surface the error verbatim; do not retry auth.                                     |
| Ticket ref provided             | argv has a ticket ref matching `[A-Z]+-\d+`              | Ask Omer for the Linear ticket ref.                                                |
| Issue exists in Linear          | A get-issue call succeeds                                | Surface the error — issue may not exist or ref may be wrong.                       |
| Issue has `from:prd-*` label    | Issue labels include `from:prd-<slug>`                   | Tell Omer the issue wasn't created by `/risoluto-to-issues` — no linked PRD found. |
| PRD exists on disk              | `test -f docs/prds/<slug>.md`                            | Tell Omer the PRD file is missing — may need to run `/risoluto-to-prd`.            |
| All blocked-by tickets are Done | Each blocked-by relation has status "Done"               | List the open blockers and tell Omer to complete them first.                       |
| Working tree clean              | `git status --porcelain` empty (at relevant paths)       | Tell Omer to commit or stash before starting.                                      |

## Pipeline

### Step 0 — Reconcile a prior run (re-run only)

`/risoluto-tdd <ticket-ref>` is **not idempotent**: a partial earlier run can leave a worktree at
`.agent-worktrees/<ticket-ref-lower>/`, a `feat/<ticket-ref-lower>-<slug>` branch, and the ticket set
In Progress. Detect that state first and reconcile, instead of hard-failing half-way at `git worktree add`:

1. **Worktree exists** (`git worktree list` shows `.agent-worktrees/<ticket-ref-lower>`) → resume it; `cd`
   in and continue the red→green loop. Do **not** create a second worktree.
2. **Branch exists, no worktree** (`git rev-parse --verify feat/<ticket-ref-lower>-<slug>`) → re-add a
   worktree onto the existing branch (`git worktree add <path> feat/<ticket-ref-lower>-<slug>`); do not
   create a new branch.
3. **Ticket In Progress, no branch/worktree** → a claim succeeded but setup failed; re-run setup cleanly
   (the claim is idempotent).
4. **A PR already exists for the branch** → this slice is past TDD; run `/risoluto-pre-pr` or merge, not
   `/risoluto-tdd` again. Stop and say so.

Only when none hold is this a fresh run — proceed to Step 1.

### Step 1 — Fetch the Linear issue

Fetch the issue (get-issue operation) with the ticket ref. Extract:

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
git worktree add .agent-worktrees/<ticket-ref-lower> -b feat/<ticket-ref-lower>-<slug> origin/integration/<prd-slug>
cd .agent-worktrees/<ticket-ref-lower>
# Secrets are not in git — symlink what the live/integration suites read:
ln -s "<main-repo-root>/.env.live.local" .env.live.local 2>/dev/null || true
```

`<slug>` is a short kebab form of the issue title. A worktree does **not** carry the `research/` submodule — if this slice touches `research/`, run `git submodule update --init research` inside it.

**Claim it.** After the worktree exists, set the ticket to In Progress (save-issue operation). No confirmation — picking up a ticket _is_ starting it. This is the lock the parallel/AFK model relies on: `risoluto-next-bundle` only offers issues that are not already In Progress, so an unclaimed ticket can be double-started by a second worktree. Claiming closes that race. If the Linear claim succeeds but a later setup step fails, restore the prior Linear state or leave a Linear comment explaining the failed claim before stopping.

### Step 3 — Read the linked PRD

From the `from:prd-<slug>` label, read `docs/prds/<slug>.md`. The PRD's:

- **Implementation Decisions** section guides architectural choices
- **Testing Decisions** section guides what to test and how
- **User Stories** inform acceptance criteria beyond what the issue itself lists
- **Out of Scope** section prevents over-implementation

### Step 4 — TDD red-green-refactor loop

Follow the TDD workflow defined in the shared coder-discipline references — [tests.md](../references/coder-discipline/tests.md), [interface-design.md](../references/coder-discipline/interface-design.md), [refactoring.md](../references/coder-discipline/refactoring.md), [mocking.md](../references/coder-discipline/mocking.md), [deep-modules.md](../references/coder-discipline/deep-modules.md) — which are authoritative for the philosophy, anti-patterns, and workflow steps:

1. **Planning** — confirm interface with Omer, identify behaviors to test, get approval
2. **Tracer bullet** — one test → one implementation → proves the path
3. **Incremental loop** — RED → GREEN, one test at a time
4. **Refactor** — after all tests pass, extract duplication, deepen modules

Key constraints from the PRD:

- Use the project's domain glossary so test names match Risoluto's vocabulary
- Respect ADRs in the area being touched
- Tests go in the project's existing test tiers (`vitest.config.ts` for unit, `vitest.integration.config.ts` for integration)
- **When an acceptance criterion describes operator-visible behaviour — a CLI command, an HTTP/webhook request, or a Slack action does X — at least one test must drive it through that real entry point, not by calling the internal function directly with stubbed collaborators.** A test that stubs `runRole`/`runAction`/a provider proves the unit; it does not prove the operator can reach it. Stub the external boundaries (network, the LLM, the git remote), but keep the path from the entry point to your code real. If you stub the entry point itself, you have tested the stub — and the gate goes green over an unshipped feature.
- **Wire what you build in the same slice, and prove the wiring.** A handler, adapter, or engine that is exported but never called from a production entry point still turns the gate green while shipping nothing. When your slice adds such a unit, connect it to its caller (the route, the command, the dispatch table) and add the reachability test above. An exported-but-uncalled symbol is "done" only if the PRD explicitly defers its wiring to a named later slice; otherwise it is incomplete. Check parity with sibling code — if you wire the Linear adapter, the GitHub adapter in the same slice needs the same wiring.

### Step 4.5 — File out-of-scope discoveries as their own issues

While implementing you will trip over things that are real but _not this slice_ — a latent bug, tech debt, a missing capability. Fixing them inline bloats the diff and muddies the red-green story, so file each as its own Linear issue with enough provenance to act on later (save-issue operation, create mode):

- **title**: `Found during <ticket-ref>: <short description>`
- **description**: what it is, why it matters, where (`path/to/file.ts:line`), and "discovered while implementing `<ticket-ref>`"
- **project**: the same Linear project as this ticket
- **labels**: `from:prd-<slug>` (same PRD lineage) plus `discovered` — create the `discovered` label once if missing (create-issue-label operation, short description, grey)

Track every follow-up in your final summary so nothing silently drops. This is distinct from the PRD's **Out of Scope** boundary (see Notes): a deliberate PRD exclusion is a conflict to raise with Omer, not an issue to file.

### Step 5 — Open PR and link to Linear

When implementation is complete and all tests pass:

1. You are already on `feat/<ticket-ref-lower>-<slug>` inside the worktree from Step 2.5 — no new branch needed.
2. Commit with a conventional commit message referencing the ticket.
3. Push the branch. **Print** the `gh pr create` command for Omer to run, targeting `integration/<prd-slug>` — **do NOT execute `gh pr create`.**
4. Apply the `from:prd-<slug>` label to the PR via `gh pr edit --add-label from:prd-<slug>` (only after Omer has opened the PR)
5. Back-comment the Linear ticket with the PR URL (save-comment operation: `issueId` + `body`, only after the PR exists). **Make it idempotent** (the marker convention from `/risoluto-sync`): list the issue's comments first and **skip** if any already contains `<!-- risoluto:tdd:<pr-url> -->`; otherwise post the comment with that marker as its first line. This keeps a re-run (or a reconcile after a partial failure) from stacking duplicate PR comments — `save-comment` has no native dedup.
6. **Reconcile the issue's acceptance criteria** (save-issue operation, editing the `description` — leave status untouched). For each line in the `## Acceptance criteria` list:
   - Tick it (`- [ ]` → `- [x]`) **only** if a test or a production entry point added in this slice actually proves it. Append a terse proof pointer in parentheses — e.g. `- [x] A stop-on-first profile halts on the first failing command … (tests/workflow-run/validation-profile.test.ts → "stops on first failure")`.
   - Leave it **unchecked** if the behaviour is only stubbed, exported-but-unwired, or deferred to a named later slice. Append `(deferred: <reason / later ticket>)` so the gap is explicit instead of silent.
   - Never tick a box you cannot point at, and never tick from "the suite is green" — green proves the unit, not that the operator can reach the behaviour (see Step 4's reachability rule). Prefer leaving a box unchecked over a tick you can't defend.

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists.
- **Linear errors are operator concerns.** Surface verbatim, stop, do not retry.
- **The `from:prd-<slug>` label on the PR is load-bearing.** Stage 4's post-merge workflow triggers on it. Always apply it.
- **Do not skip the blocked-by validation.** The dependency graph exists for a reason — implementing out of order produces integration failures.
- **The shared coder-discipline files (`../references/coder-discipline/`) are authoritative** for test philosophy and patterns. They mirror the generic global `tdd` skill — the TDD philosophy doesn't change, only the Linear integration is added. The afk-orchestrator daemon's coder prompt injects the same files.
- **PRD Out of Scope is a hard boundary.** If the issue's acceptance criteria seem to require something the PRD explicitly scopes out, surface the conflict to Omer rather than implementing it.
- **Work in a worktree, never in-place.** `risoluto-next-bundle`'s disjoint-locality reasoning only pays off if bundled slices run as parallel worktrees; implementing in the main checkout forfeits that and risks index collisions with a sibling run.
- **Merge ticket branches into the integration branch first.** For this PRD, the reviewable branch is `integration/<prd-slug>`; ticket PRs target that branch, and Codex reviews the finished integration branch after Claude/Codex workers have merged their slices.
- **Claiming (In Progress) is not optional and not confirmed** — it is the lock that stops two parallel runs from grabbing the same ticket. Leave the ticket In Progress at PR-open. **Who marks Done:** whoever merges the branch — the AFK conductor's merge agent in the cascade path, or the operator / `/risoluto-sync` in the manual path — always from a merged branch + proof, **never this skill** and never from a green suite. (`goal-run`'s merge agent and `/risoluto-sync` are the two Done-writers; this is the resolution of the apparent "who marks Done" overlap.)
- **Acceptance criteria are ticked from proof, not from status.** Step 5.6's PR-open reconciliation is the only place boxes get checked, and every tick must cite the test or entry point that closes it. Status never auto-ticks a box: a `Done` issue with an unchecked box is the intended signal that the slice deliberately deferred that criterion, not a bookkeeping miss. This closes the gap where a whole goal reaches `Done` with every acceptance box still empty because no step ever wrote them back.
- **Filed discoveries vs. the Out-of-Scope boundary.** Incidental finds become `discovered` issues (Step 4.5); things the PRD deliberately excludes are surfaced to Omer, not filed.
- **Hand off to Stage 3.5 before the PR opens.** After this skill prints `gh pr create`, the operator may run `/risoluto-pre-pr` — the advisory review/cleanup pass (`/code-review` → `/simplify` → mandatory `/v1-check`) — on the branch before opening the PR. It is advisory and writes no Linear state, so the label, back-comment, and acceptance-criteria reconciliation in Step 5 remain this skill's job after the PR exists.
- **Cross-model acceptance check before merge.** Step 5.6 ticks boxes with the _same_ model that wrote the code — the blind spot that shipped NIN-219/220. Run `/risoluto-verify-acceptance <ticket-ref>` (a different model checks every acceptance criterion against the diff + tests) as Stage 3.6 — after the advisory `/risoluto-pre-pr` pass (Stage 3.5) and before the slice is merged; treat any `NOT_MET` as a blocker. Recommended, not gating — but the recommended default for any slice headed into an AFK merge.

## Companion files

- `docs/research-to-shipping-pipeline.md` — Stage 3 spec
- the generic global `tdd` skill — the tracker-agnostic upstream this forks from (kept generic; never edited here)
- `skills/risoluto-to-issues/` — Stage 2; creates the Linear issues this skill implements
- `skills/risoluto-to-prd/` — Stage 1; produces the PRD this skill references
- `skills/risoluto-verify-acceptance/` — recommended cross-model acceptance check before `gh pr create` (a different model verifies each criterion; `NOT_MET` blocks)
- `.github/workflows/post-merge.yml` — Stage 4; triggers on the `from:prd-*` label this skill applies
