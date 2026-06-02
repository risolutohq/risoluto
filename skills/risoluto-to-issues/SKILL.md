---
name: risoluto-to-issues
description: 'Risoluto-repo variant of to-issues: breaks a PRD at `docs/prds/<slug>.md` into flat Linear Issues labelled `from:prd-<slug>` in the project''s Linear workspace. Use when Omer says /risoluto-to-issues, "break <slug> into issues", "create tickets from the <slug> PRD", or any variation that implies turning a Risoluto PRD into Linear Issues. Primary trigger is /risoluto-to-issues (not /to-issues — that is the generic global skill and must not be conflated with this one). Fork of the global skill; this one is Linear-specific. Phase 4.1 of docs/research-to-shipping-pipeline.md.'
---

# risoluto-to-issues

PRD-to-Linear-Issues breaker for the Risoluto planning pipeline. Phase 4.1 of the planning-pipeline roadmap. Forked from the generic global `to-issues` skill — keep that one tracker-agnostic, never edit it; the Linear-specific behaviour and the flat-issue-with-blocked-by layout live here.

> **Linear access (agent-portable).** This skill names Linear **operations**, not a fixed tool. Bind each operation to whatever Linear surface your agent has: under **Claude**, the Linear MCP tools (`mcp__linear-server__<op>` — e.g. `list_issues`, `save_issue`, `list_issue_labels`, `create_issue_label`, `save_milestone`, native attachment/link operation, `list_teams`); under **Codex** or any agent without the Linear MCP, `LINEAR_API_KEY` + the Linear GraphQL API — see [`../references/linear-access.md`](../references/linear-access.md) for ready-to-run queries for every operation this skill uses (`risoluto-to-prd` Step 3 covers the project mutations). `.codex/config.toml` ships no Linear MCP, so GraphQL is the Codex path. If neither surface is reachable, surface the error verbatim and stop — never retry auth.

## What this skill produces

For one `<prd-slug>` per invocation:

1. An LLM-inferred slice graph: a set of vertical slices with **two edge types** — hard `blocked-by` dependencies and soft `related` couplings — extracted from the full PRD body (no explicit `## Slices` section required — the LLM reads the whole PRD).
2. Operator review of the proposed graph (accept, reject with feedback, or edit).
3. The five required labels, verified-or-created before any issue exists (Step 2.5).
4. Build-wave milestones on the PRD's Linear Project, one per dependency layer (Step 2.6).
5. Flat Linear Issues created on the same Project as the PRD (resolved from `docs/prds/<slug>.md` frontmatter `linear_project`), each with:
   - Linear "blocked-by" relations matching the approved dependency graph
   - Linear "related" relations for the soft couplings
   - Its build-wave `milestone`
   - Labels: `bundle:<category>` (derived from the PRD body or roadmap row — see Notes), `tracer`, `slice:hitl` or `slice:afk`, `from:prd-<slug>`
   - A native link attachment to the canonical git PRD (see Notes)
   - Issue body (Parent, What to build, Acceptance criteria, Blocked by, Related) per the template below
6. Issues published in dependency order (blockers first) so real identifiers can be used in "Blocked by" and "Related" fields.

## Hard preconditions

Stop and report if any of these fail. Do **not** retry Linear auth from inside this skill — if Linear errors, surface it to the operator.

| Check                             | Command / verification                                   | If it fails                                                                                                                               |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Run from repo root                | `test -f package.json && test -f .gitmodules`            | Tell Omer to `cd` into the `risoluto` checkout root.                                                                                      |
| `research/` initialised           | `git submodule status research` starts with a space      | Tell Omer to `git submodule update --init research`.                                                                                      |
| PRD exists                        | `test -f docs/prds/<slug>.md`                            | Tell Omer to run `/risoluto-to-prd <slug>` first.                                                                                         |
| PRD has `linear_project`          | frontmatter `linear_project` is non-null                 | Tell Omer to run `/risoluto-to-prd <slug>` first.                                                                                         |
| PRD has `source`                  | frontmatter `source` is non-null                         | Acceptable to proceed; `source` may be absent for older PRDs.                                                                             |
| Linear reachable                  | A Linear connectivity probe succeeds (see Linear access) | Surface the error verbatim; do not retry auth.                                                                                            |
| Issues for this PRD already exist | A list-issues-by-label query returns non-empty           | This is a re-run — go to **Step 0 — Reconcile**: resume to create only missing slices, or abort. Never blind-create over an existing set. |

## Pipeline

Steps: **preload** → **extract + review** → **label preflight** → **milestones** → **create**. The extract step (inferring the slice graph) happens in the agent's head; the deterministic preload script handles context gathering so the agent has everything it needs. On a **re-run** (issues for this PRD already exist), **Step 0 — Reconcile** runs first so a partial earlier run is resumed, not duplicated.

### Step 0 — Reconcile if issues already exist (re-run only)

Runs only when the precondition found existing `from:prd-<slug>` issues — i.e. a previous run created some or all of them, possibly partially (an attachment rate-limit or a Linear error can leave a batch half-created — see Notes). Blind-creating on top duplicates the board, so reconcile first.

1. Fetch the existing set (list issues with label `from:prd-<slug>`) with their titles and `blockedBy` relations.
2. Run the normal extraction (Step 2) to get the slice graph the PRD _would_ produce now, then diff it against what exists, matching by slice title:
   - **Missing** — slices with no matching issue.
   - **Extra** — existing issues with no matching slice (PRD shrank, or a stale run).
   - **Drifted** — title matches but `blockedBy` / labels / milestone differ.
3. Present the diff and offer Omer three paths:
   - **Abort** (default) — touch nothing.
   - **Resume** — create only the **missing** slices, wiring their `blockedBy` / `relatedTo` to the already-existing issues by title match. The safe path after a partial failure.
   - **Reconcile** — walk the diff item by item; Omer decides per slice whether to create, re-wire, or leave it.

Creating the full set unconditionally when issues already exist is the one move that dupes the board — never do it.

### Step 1 — Preload the context bundle

```bash
node skills/risoluto-to-issues/scripts/preload.mjs <prd-slug>
```

Stdout: JSON with slug, linear_project URL, PRD path, PRD body, source (from PRD frontmatter), roadmap_row (item, why_now, size, status), and derived category.

Stderr: one-line summary. Show Omer the summary.

Then read the PRD body in full — this is the material the LLM pass will extract slices from.

### Step 2 — Extract slices via LLM pass

Read the full PRD body and extract a proposed slice graph:

- Each slice: title, type (HITL/AFK), blocked-by (hard dependencies), related (soft couplings — see below), user stories covered, and a one-line predicted code locality (the module/dir it will mostly touch)
- Slices are vertical (tracer bullets) — each cuts through all layers end-to-end
- Prefer many thin slices over few thick ones
- **Two edge types, kept distinct.** A `blocked-by` edge means "cannot start until the other merges" — a real ordering constraint. A `related` edge means "shares a contract, module, or concern but neither blocks the other" — e.g. two adapters that both implement the same signature contract, or a slice whose behaviour is _tested_ inside another slice. Do not encode a soft coupling as a hard block: over-serializing the graph forfeits parallel worktrees for no gain. The `related` edges are what `risoluto-next-bundle` reads to reason about code locality, so they earn their keep.
- Non-deterministic: the same PRD may produce different graphs on different runs

Present the proposed graph to Omer as a numbered list:

- **Title**: short name
- **Type**: HITL / AFK
- **Blocked by**: hard-dependency slices (or "None")
- **Related**: soft-coupling slices (or "None")
- **User stories covered**: which PRD user stories this addresses
- **Predicted locality**: the module/dir this slice will mostly touch

Ask Omer:

- Does the granularity feel right?
- Are the dependency relationships correct?
- Is anything encoded as a hard `blocked-by` that is really a soft `related` coupling (or vice-versa)?
- Should any slices be merged or split?
- Are HITL/AFK assignments correct?

Iterate until Omer approves. If Omer rejects, re-run the inference with his feedback as additional context.

### Step 2.5 — Label preflight

Before creating any issue, make sure the labels it will reference exist — Linear rejects an issue that names a missing label, and creating them mid-loop is noisy. For each required label — `from:prd-<slug>`, `tracer`, `slice:afk`, `slice:hitl`, `bundle:<category>` — list existing labels (list-issue-labels operation, team `Ninetech`) and create any missing one (create-issue-label operation), giving it a short `description` and a stable `color` so the board stays legible. Suggested palette: `from:prd-*` grey, `tracer` cyan, `slice:afk` green, `slice:hitl` orange, `bundle:*` indigo. These are team-level labels — create once, reuse across PRDs.

### Step 2.6 — Derive build-wave milestones

Group the approved slices into 3–6 **build waves** by dependency depth (roots first, capstone last) and create one Linear milestone per wave (save-milestone operation) on the PRD's project. Name them `Wave N - <theme>` and give each a short theme description first; the issue IDs do not exist yet. Each issue created in Step 3 gets its wave's `milestone`. After issue creation, update each milestone description with the member issue IDs/URLs.

Milestones here are a **visual build-order aid, not a ready-set gate.** A slice can be dependency-shallow yet sit in a late wave because it is thematically "readiness" (e.g. an offline doctor probe that only needs the registry). The live ready-set — what is startable _now_ — is whatever has no open `blocked-by`, which `risoluto-next-bundle` computes dynamically. Say this to Omer when you present the waves so a late-wave-but-shallow slice isn't mistaken for "blocked."

### Step 2.7 — Slice-graph quality bar (gate before creating)

Before creating anything, run the approved graph through these checks. They exist because adversarial review passes keep finding the same failure classes — fix what fails and re-confirm with Omer rather than shipping a graph that can't be built or tested.

1. **Gating completeness.** If a slice's headline behaviour gates on conditions produced elsewhere (e.g. auto-merge needs green CI + a post-publish verdict + an approval), it must be `blocked-by` the slices that produce those conditions — or that composition must be split into its own completion-gate slice that depends on them. A slice whose headline behaviour cannot be satisfied when it lands is mis-scoped. (Distinguish policy from wiring: a slice may implement a _policy_ testable against fakes and stay light on deps; the slice doing the _real composition_ is the one that needs the hard edges. Name both.)
2. **No orphans.** Every slice must be reachable from the capstone's `blocked-by` chain, or be explicitly justified as an optional enhancement the capstone does not exercise. A leaf that nothing depends on and the capstone never runs will ship untested.
3. **Evidence-consumers sit after their inputs.** A slice that re-confirms, projects, summarises, or renders evidence produced by another slice (post-publish reconfirm, status projection, handoff) must depend on — or at least be `related` to — the slices that produce that evidence, and never sit in an earlier wave than its inputs.
4. **One owner per artifact contract.** List every contract the PRD names and assign each exactly one owning slice — stamp "defines and owns `x.v1`" there; downstream slices "extend" or "consume", never "define". Zero owners → drift; two owners → duplicate schemas. Keep the owner map in the framework slice as the index.
5. **Named invariants get ACs.** Every security boundary or explicitly-named PRD invariant needs a falsifiable AC on some slice, not just prose. Easy ones to drop: "no shell/DSL in config", "schema version from day one", "run identity is never the tracker issue id", "the idempotency claim is transactional", "CI required for ready/auto-merge". If the PRD calls it a boundary, an issue must test it.
6. **AC density tracks story load.** A slice covering many user stories needs ACs that hit its load-bearing and riskiest behaviours, not three generic lines. If a 7-story slice has 3 ACs that miss the hard part (the concurrency claim, the normalization, the gating requirement), add ACs or split the slice.
7. **The capstone tests the risky negatives.** The end-to-end / dogfood slice must assert the dangerous paths are correctly _refused_, not just that the happy paths work — e.g. "auto-merge with no approval stays blocked", "a budget overrun hard-stops", "raw evidence is not committed". A capstone that only checks success is not a gate.
8. **Reachability: every operator-invocable capability has a slice that owns its production wiring, and the capstone drives a real entry point.** A PRD that says an operator starts a run from the CLI / a webhook / a Slack action implies a path from that entry point to the engine. Make a slice own that wiring (the route → handler → engine dispatch), with an AC that asserts the entry point actually reaches the engine — not just that an internal function exists. A library/engine slice that builds `executeX` but no slice connects it to a runnable surface ships a green-but-dead feature. And the capstone's AC must drive at least one capability through its **real** entry point (a CLI invocation, a signed webhook/Slack request), not hand-compose the modules with stubbed role/action/provider outputs — otherwise the capstone proves the pieces, never the product. (This is the "policy vs wiring" split from check #1 taken to the boundary: name the slice that does the real composition _and_ the slice that exposes it to an operator.)

### Step 3 — Create Linear Issues

For each approved slice, in dependency order (blockers first):

1. Create the issue (save-issue operation, create mode — no `id` field) with:
   - `team`: `"Ninetech"` — required on create (the schema mandates it even when `project` would seem to imply it)
   - `title`: slice title
   - `description`: issue body (using the template below)
   - `project`: the Linear Project ID from the PRD's `linear_project` frontmatter
   - `labels`: `["bundle:<category>", "tracer", "slice:hitl"|"slice:afk", "from:prd-<slug>"]`
   - `milestone`: the slice's build-wave milestone from Step 2.6
   - `blockedBy`: Linear issue IDs of blocker slices (already created since we go in order)
   - `relatedTo`: Linear issue IDs of soft-coupling slices that already exist; set any that point at not-yet-created slices in a second pass once all issues exist (`relatedTo` is append-only)
   - PRD attachment: create a native URL attachment on the new issue (attach-url operation) with `url: "<git blob URL of the PRD>"` and `title: "PRD (canonical git source)"` (see Notes for the URL shape and the rate-limit caveat)
2. Record the returned issue ID/URL for use in subsequent slices' `blockedBy` / `relatedTo`.
3. Do **not** set `priority` or `estimate` by default — see Notes.

**Issue body template:**

```markdown
## Parent

PRD: [docs/prds/<slug>.md](https://github.com/risolutohq/risoluto/blob/<default-branch>/docs/prds/<slug>.md)

## What to build

[Concise description of this vertical slice. Describe end-to-end behavior, not layer-by-layer implementation. Avoid specific file paths or code snippets — they go stale fast.]

## Acceptance criteria

<!-- Each criterion is a falsifiable BEHAVIOURAL assertion — the spec for a failing test /risoluto-tdd will write, e.g. "a Workflow Run failing at step 3 replays from 3, not 0". NOT the global gate (build/lint/test/typecheck/coverage); every merge enforces that already. -->

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

<!-- One blocker per line as a bullet — a comma-run is unreadable in Linear past two entries. -->

- NIN-123 Blocker title
- NIN-124 Another blocker title

(or "None - can start immediately")

## Related

<!-- Soft couplings only — these become `related` relations, NOT blockers. Omit the section if there are none. -->

- NIN-125 Related slice title — one-line why (shared contract / module / test)
```

## Notes for the agent

- **Default to the `Ninetech` Linear team without asking.** Only one team exists.
- **Linear errors are operator concerns.** Surface verbatim, stop, do not retry.
- **The `from:prd-<slug>` label is load-bearing.** Phase 4.2's TDD skill uses it to find the linked PRD, and Phase 4.3's post-merge workflow uses it to trigger automation. Always apply it.
- **`bundle:<category>` is derived from the PRD/roadmap**, not from a deleted backlog file. The preload script checks for an explicit `**Category:**` line in the PRD body first; if absent it infers from the first word of the roadmap Item cell. If neither yields a value, omit the `bundle:` label and note it to Omer.
- **Acceptance criteria are the red-test spec — gate on it.** Each criterion must be a falsifiable behavioural assertion the future `/risoluto-tdd` run can turn into a failing test (e.g. "a Workflow Run failing at step 3 replays from 3, not 0"). **Refuse to emit any issue that cannot name at least one such assertion** — a slice with no falsifiable behaviour is not ready to start; sharpen it with Omer first. Do **not** restate the global gate (build / lint / test / typecheck / coverage) as acceptance — every merge enforces it already, so it is noise. The failing test is the definition of done; there is no separate DoD field.
- **Non-deterministic slice extraction is intentional.** The operator reviews and approves — the skill doesn't claim to produce the "correct" graph, just a reasonable starting point.
- **Issues are flat, not nested.** No parent-child hierarchy. Ordering dependencies are `blocked-by`; soft couplings are `related` — both are flat relations, never sub-issues.
- **Do NOT close or modify the Linear Project.** Issues are created under it; the Project stays open.
- **PRD link is the git blob URL, not the Linear project.** The canonical PRD lives in git; link to `https://github.com/risolutohq/risoluto/blob/<default-branch>/docs/prds/<slug>.md` (read the branch with `git symbolic-ref --short HEAD`, usually `master`). Put it in the body "## Parent" line _and_ create a native URL attachment so it shows in Linear's sidebar. Never point it at the `linear_project` URL — that is circular (clicking "the PRD" from inside Linear just reloads the project).
- **Attaching PRD URLs can rate-limit.** Linear throttles attachment creation; if the attach-url operation returns a rate-limit error the issue's other fields still saved — just retry the attachment on that issue after a short gap.
- **Announce the create batch before firing.** Before the Step 3 loop, state how many issues you will create and in what dependency order. If a mid-batch call fails (the attachment rate-limit above, a Linear hiccup), Omer can see how far it got — and the next run's Step 0 can resume from the gap instead of starting over.
- **Never remove a `blocks` edge and add a `related` edge for the same pair in one save-issue call** — Linear rejects the mixed relation transaction. Do it in two calls (remove first, then relate).
- **Priority and estimates are off by default.** Linear `priority` means importance/urgency, not build order — using it for topological depth is semantically muddy, and milestones + `blocked-by` + a "not blocked" saved view already convey order. Set `priority` only coarsely (High = current wave, Low = capstone tail) and only if Omer asks for Linear's priority sort. Leave `estimate` until a first run reveals real slice size.

## Companion files

- `docs/research-to-shipping-pipeline.md` — Phase 4.1 spec
- the generic global `to-issues` skill — the tracker-agnostic upstream this forks from
- `skills/risoluto-to-prd/` — Phase 3.2; produces the PRD this skill consumes
- `skills/risoluto-tdd/` — Phase 4.2; picks up individual issues created by this skill
