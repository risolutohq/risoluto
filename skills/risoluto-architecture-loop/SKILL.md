---
name: risoluto-architecture-loop
description: Autonomous, headless architecture-deepening loop for the Risoluto repo — the body of a native Claude Code /goal. Use when Omer says /risoluto-architecture-loop, run the architecture loop, deepen the architecture, start an arch-deepening goal, or autonomously improve the codebase architecture until discovery runs dry. Self-discovers shallow-to-deep module candidates (Explore subagents plus the vendored deepening rubric, never the interactive command), self-authors each Strong candidate's contract into a Linear sub-issue, builds it with /risoluto-tdd in an isolated worktree, gates it (/v1-check, /code-review, cross-model /risoluto-verify-acceptance), and merges into integration/architecture-loop one candidate at a time until discovery is exhausted, then prints gh pr create. Distinct from improve-codebase-architecture (the interactive, manual, HTML-report founder tool) and risoluto-goal-run (the PRD goal-package conductor); this loop is headless, self-directed, and finds its own work.
---

# risoluto-architecture-loop

The **headless body of a native Claude Code `/goal`** that autonomously deepens the Risoluto codebase's
architecture — one candidate at a time, until discovery runs dry. It leaves behind **merged deepenings**
on `integration/architecture-loop` (shallow→deep modules: better locality/leverage, more testable, more
AI-navigable), not a backlog of reports.

You set the `/goal` completion condition from the bundled [`GOAL.md`](./GOAL.md); the `/goal` evaluator
checks it each turn and Claude keeps working across turns until it holds. This skill is the operating
procedure the loop follows on every turn. The full design rationale lives in
`~/.risoluto/goals/risoluto-architecture-loop/SPEC.md` (the locked design); this file is its executable
form. Decisions in SPEC §2–§8 are **locked** — follow them, don't re-litigate.

> **Linear access (agent-portable).** This skill names Linear **operations**, not a fixed tool. Under
> **Claude** bind each to the Linear MCP tools (`mcp__linear-server__<op>` — `list_projects`,
> `save_project`, `list_issues`, `get_issue`, `save_issue`, `save_comment`, `create_issue_label`,
> `list_teams`); without the MCP, use `LINEAR_API_KEY` + the GraphQL API per
> [`../references/linear-access.md`](../references/linear-access.md). If neither is reachable, surface the
> error verbatim and stop — never retry auth.

## What this is — and what it is NOT

- **IS:** a self-directed, unattended loop. It finds its own work, builds it, verifies it, and merges it
  with **no interactive approval**. Passive control is via Linear (comment/close the run issue to
  pause/stop); live steering is the `/goal` overlay + Remote Control; push status is Slack.
- **NOT `improve-codebase-architecture` (the interactive founder tool — a global Claude Code skill, not in this repo).** That skill writes
  an HTML report, asks _"which would you like to explore?"_, and grills the founder. This loop **never**
  invokes that command and **never** halts for a human pick. It reuses only that skill's companion
  **rubric files** — vendored into [`references/`](references/): [`LANGUAGE.md`](references/LANGUAGE.md)
  (depth/seam/deletion-test vocabulary), [`DEEPENING.md`](references/DEEPENING.md) (patterns),
  [`INTERFACE-DESIGN.md`](references/INTERFACE-DESIGN.md) (contract shape),
  [`HTML-REPORT.md`](references/HTML-REPORT.md) (final report scaffold).
- **NOT [`risoluto-goal-run`](../risoluto-goal-run/).** That runs a **PRD-derived** goal package
  (`/risoluto-goal-prep` waves → `Workflow` cascade). This loop has **no PRD**: each candidate's
  Linear sub-issue body **is** its contract, and discovery — not a frozen wave map — drives what gets
  built. They share the integration-merge + print-only-PR discipline, nothing else.

## Model + tool map (SPEC §7)

| Role                          | Tool / surface                | Model                                                      |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Builder (this loop / `/goal`) | the `/goal` session           | `claude-opus-4-8`                                          |
| Discovery                     | `Explore` subagents           | `claude-sonnet-4-6`                                        |
| Per-fix referee (≈8×/run)     | `/risoluto-verify-acceptance` | **DeepSeek V4 Pro** (`deepseek-v4-pro`) via `opencode`     |
| End oracle (1×/run)           | `/risoluto-review-handoff`    | **Codex GPT-5.4 high** (local auth); opt-in `gpt-5.5 high` |

Launch the `/goal` itself on `claude-opus-4-8`. Discovery `Explore` subagents run on `claude-sonnet-4-6`
(scope their prompts accordingly). The referee is cheap and fires per candidate; the Codex oracle fires
**once per run**, protecting a limited Codex/GPT quota by construction.

## Phase 0 — Preflight (GO/NO-GO) (SPEC §5)

> **Not the `risoluto-preflight` skill.** This Phase 0 is the architecture-loop's own
> repo/model-auth wiring check. The `/risoluto-preflight` skill is the separate interactive
> roadblocker interview that gates a PRD-based AFK build — different checks, different trigger.

Run **before any Linear write or code edit**. Block on the first failure — never start the loop on a
broken precondition.

| #   | Check                           | Verification                                                                                                                                                                    | NO-GO if                                              |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Repo root                       | `test -f package.json && test -f .gitmodules`                                                                                                                                   | Not in the Risoluto checkout root.                    |
| 2   | Repo clean (tracked)            | `git status --short \| grep -v '^??'` empty — untracked project docs (`CONTEXT.md`, `DISCOVERY.md`, `research/`) are **not** contamination; check #3 still bans tracked scratch | Uncommitted work would contaminate the cascade.       |
| 3   | No tracked scratch markdown     | no tracked `PLAN.md` / `ATTEMPTS.md` / `NOTES.md` / `CONTROL.md` / `DISCOVERY.md`                                                                                               | Repo-local runtime scratch is banned (memory→Linear). |
| 4   | `research/` submodule init      | `git submodule status research` leads with a space, not `-`                                                                                                                     | Run `git submodule update --init research`.           |
| 5   | Base branch                     | `git branch --show-current` is `master`                                                                                                                                         | Launch from `master`.                                 |
| 6   | Integration branch ready        | `git rev-parse --verify integration/architecture-loop` (else create it off `master` and push)                                                                                   | Cannot create the branch.                             |
| 7   | Linear auth live                | a `list_teams` / GraphQL probe succeeds (team **RIS**)                                                                                                                          | Surface verbatim; do not retry auth.                  |
| 8   | DeepSeek reachable via opencode | `command -v opencode` and `deepseek-v4-pro` in `opencode models`                                                                                                                | Referee gate cannot run — fix opencode provider.      |
| 9   | Codex local auth live           | Codex CLI authenticated for `gpt-5.4 high`                                                                                                                                      | End oracle cannot run.                                |
| 10  | Required secrets present        | `LINEAR_API_KEY`, Slack, opencode/DeepSeek keys (existence only)                                                                                                                | Missing credential — fix before launch.               |

Emit a single **GO** / **NO-GO** verdict with the failing row(s). The first interactive run should babysit
1–2 candidates through discover→build→gate→merge with Remote Control on, then trust it for headless runs.

**Orphan reconcile (run before check #2).** A crashed mid-build turn can leave a `.agent-worktrees/arch-<hash>`
worktree and an `arch/<hash>-*` branch behind; on resume `git worktree add` then fails `already exists` and
strands the loop. So sweep first: for each stale `arch-*` worktree/branch (`git worktree list --porcelain`),
look up the matching candidate sub-issue by its `hash` label — if it is `rejected`/`blocked`,
`git worktree remove --force <path>` + `git branch -D <branch>`; if it is still `open` it crashed mid-build, so
discard the worktree, mark the sub-issue `blocked` (reason "orphaned mid-build crash"), and re-queue it next
pass; if no sub-issue matches, discard unconditionally. This is the arch-loop analogue of `/risoluto-tdd`'s
Step 0 reconcile.

## Working memory — Linear-primary hybrid (SPEC §2)

Durable memory and control live in **Linear**, never in repo-local scratch markdown.

- **Project** `Risoluto Architecture Loop` — team **RIS**, created **once** and reused idempotently
  (search-before-create with `list_projects`; never the Live Sandbox).
- **Run issue** — one per `/goal` launch. Its body holds the run config (completion condition, `K=2`,
  `fuse=8`, the model map); its comments hold the narrative `ATTEMPTS`/`NOTES` log. This is the
  goal-forge "working memory" pillar, in Linear. Its Linear identifier (e.g. `RIS-42`) **is** the `<run-id>`:
  capture it as `RUN_ID` once when the run issue is created/found in Phase 0, and use it verbatim in every
  `/tmp` path and the final HTML filename (`/tmp/risoluto-architecture-loop/RIS-42/…`,
  `$TMPDIR/architecture-loop-RIS-42.html`); never re-derive it mid-run.
- **Candidate sub-issues** — children of the run issue, one per `Strong` candidate. State
  `open → merged | rejected | blocked`. Each carries a `hash` label (computed at discovery — see
  **Anti-thrash**), the branch/PR link, and the referee verdict. The sub-issue **body is the self-authored deepening contract**
  (see Discover→Self-author below).
- **Anti-thrash (cross-run):** before opening a candidate, query the project for any sub-issue (any run)
  whose `hash` label is already `merged`/`rejected` — if found, **skip** it. Candidates are first-class
  issues precisely so this dedup survives across runs.
  - **Hash stability (the executable reading of SPEC §2's `hash(files + problem statement)`).** Compute the
    label at **discovery time** (step 1, before self-authoring) as
    `sha256(sorted_unique_repo_relative_file_paths + "\n" + normalized_problem_framing)` truncated to 12 hex
    chars. `normalized_problem_framing` is the lower-cased, whitespace-collapsed **one-line** deletion-test
    statement — **not** the free-form contract prose written in step 3 (that prose varies run-to-run, so
    hashing it would silently defeat dedup, and it doesn't exist yet at step 1).
- **`/tmp` projection:** `/tmp/risoluto-architecture-loop/<run-id>/ledger.json` — one row per candidate
  `{ id: hash, strength, status }`, **rebuilt from Linear at run start**. The evaluator counts it; Linear
  is the source of truth, the JSON is the fast read.
- **Dry-counter storage.** The consecutive-dry count must survive `/goal` turns and crashes, so it lives on
  the **run issue**, not only in the `/tmp` ledger: after each discovery pass append a marker comment
  `<!-- risoluto:arch-dry --> DRY_COUNTER=<n>` — `<n>` incremented when the pass yields zero `open`+`Strong`
  candidates, reset to `0` when it yields ≥1. At run start (ledger rebuild) read the **latest** such comment
  to restore the counter; the evaluator reads it for `done_when` #1. Linear is durable; the ledger is the fast read.
- **Rejected with a load-bearing reason** ⇒ optionally record an ADR in `docs/adr/` so future runs don't
  re-suggest it.

## Per-candidate pipeline (SPEC §3) — strictly sequential

Candidates are processed **one at a time**. Deepenings are sequence-dependent — deepening module A
changes what is shallow about B — so each discovery pass must see the prior merges. `/goal` is a
single-session agent, which fits. Never parallelize candidates.

### 1. Discover (headless)

Run the discovery discipline as an `Explore` subagent sweep (model `claude-sonnet-4-6`) guided by the
vendored rubric — read [`references/LANGUAGE.md`](references/LANGUAGE.md) and
[`references/DEEPENING.md`](references/DEEPENING.md) first so candidates are named in the shared
vocabulary (module / interface / seam / adapter / depth / leverage / locality).

- **Never** invoke the interactive `improve-codebase-architecture` command; **never** halt for
  _"which would you like to explore?"_.
- Apply the **deletion test** to each suspected-shallow module (would deleting it concentrate complexity,
  or just move it? "concentrates" = a real candidate).
- Classify each candidate `Strong | Worth exploring | Speculative`.
- **Respect ADRs and the domain language** — read `docs/product-spine.md`, `docs/technical-spine.md`,
  `docs/decisions.md`, and the relevant `docs/adr/*.md` for any touched area. A candidate that
  contradicts an ADR or needs a product decision is **deferred/blocked**, not forced through.
- **Upsert** candidate sub-issues + the `/tmp` ledger. **Skip** any `hash` already `merged`/`rejected` in
  any run (anti-thrash).
- **Build gate:** only `Strong` candidates are auto-built. `Worth exploring` / `Speculative` are logged
  to the ledger and **never built unattended** (the founder triggers those manually).

### 2. Select

Pick the highest-strength, **oldest `open` `Strong`** candidate. If none exists, **increment the
consecutive-dry counter** and re-discover (the stop condition keys on this — see Termination).

### 3. Self-author the deepening contract

The loop **self-grills** (plays interviewer + answerer) and writes the deepened module's **interface /
invariants / seam / error modes / test-surface + acceptance criteria** into the selected candidate's
Linear sub-issue **body**, using [`references/INTERFACE-DESIGN.md`](references/INTERFACE-DESIGN.md) as the
rubric. This contract is the spec `/risoluto-tdd` builds against and the referee verifies against — there
is no PRD, so the sub-issue body **is** the PRD-equivalent. The acceptance criteria are the falsifiable,
red-test spec; write them so a different model can rule each one `met`/`not-met` from the diff.

### 4. Build

- Create an isolated **worktree + branch off the `integration/architecture-loop` tip** (never `master`,
  never a `Workflow` `isolation: 'worktree'` — that branches off `master` and breaks the topology):

  ```bash
  git fetch origin
  git worktree add .agent-worktrees/arch-<hash> -b arch/<hash>-<short-slug> integration/architecture-loop
  ```

- **Run `/risoluto-tdd`'s _method_ directly — do not invoke it as a slash command.** `/risoluto-tdd`
  hard-refuses any issue without a `from:prd-<slug>` label **and** a `docs/prds/<slug>.md` file (its
  Hard-preconditions table); an arch-loop candidate sub-issue has neither. So drive its red→green→refactor
  loop (its Step 4) directly, using the shared coder-discipline references for method —
  [`tests.md`](../references/coder-discipline/tests.md), [`interface-design.md`](../references/coder-discipline/interface-design.md),
  [`refactoring.md`](../references/coder-discipline/refactoring.md), [`mocking.md`](../references/coder-discipline/mocking.md),
  [`deep-modules.md`](../references/coder-discipline/deep-modules.md) — with these substitutions:
  - **Spec / "PRD" = the candidate sub-issue body** you self-authored in step 3; its `## Acceptance criteria`
    block is the criteria. There is no PRD file to read.
  - **Integration base = `integration/architecture-loop`** (the worktree above is already on it) — never
    `integration/<prd-slug>`, and no `from:prd-<slug>` label is applied (this loop ships one consolidated PR
    at the end; see Termination).
  - **Honor `/risoluto-tdd`'s reachability rule:** wire what you build and prove it through a real entry
    point — an exported-but-uncalled symbol is not done.

### 5. Gate (in strict order; stop on the first failure)

1. **`/v1-check`** — the full canonical gate
   (`build → lint → format:check → test → typecheck → typecheck:coverage`).
2. **`/code-review high`** — `xhigh` for high-risk areas. Findings are **evidence, not authority** —
   verify each against the actual diff and source before acting.
3. **`/risoluto-verify-acceptance`** — the per-fix referee. Invoke it with the opencode model pinned to
   **`deepseek/deepseek-v4-pro`** (that skill owns the concrete `opencode run --pure --format json …`
   invocation — plain `run`, `--pure`, no `--agent`; don't re-derive the command here). Two arch-loop
   substitutions to its Step-1 packet: there is **no PRD**, so put the **candidate sub-issue body** in the
   packet's _PRD-context_ slot (delimit it `## Contract (sub-issue body)`) and skip the `from:prd-<slug>`
   resolution entirely — the `## Acceptance criteria` block is already in that body. It is adversarially
   prompted to **default to `not-met` / escalate when unsure** — a rubber-stamping cheap model is worse than none.
   - `met` → proceed to merge.
   - `not-met` → mark the sub-issue `rejected`, **discard the worktree** (+ ADR if load-bearing). Do not
     merge.
   - **infra/opencode error** (not a real verdict) → **safe-defer:** mark the sub-issue `blocked`,
     Slack-ping, move to the next candidate. Never stall the goal; never merge unverified.

### 6. Merge / discard

- **Pass:** merge the worktree branch into `integration/architecture-loop`, mark the sub-issue `merged`
  (record the verdict + branch link), and discard the worktree
  (`git worktree remove --force …`). **`master` is never touched.**
- **Fail:** discard the worktree, mark the sub-issue `rejected` (+ ADR if load-bearing) or `blocked`
  (infra). `integration/architecture-loop` never sees half-built work.

### 7. Loop

Re-discover (step 1); update the consecutive-dry counter — **reset it to `0` if a candidate merged this
iteration, otherwise it was already incremented in Select (step 2)** — then check the stop condition
(Termination). "Consecutive" means the count only climbs across passes that find nothing; any merge resets it.

## Termination & output (SPEC §4)

**Stop** on **any** of (mirrors `GOAL.md` `done_when`):

1. **`K = 2` consecutive fresh discovery passes** each surface **zero `open` + `Strong`** candidates
   (discovery-exhaustion) — primary.
2. **8 candidates `merged`** (hard fuse; runaway backstop).
3. **Manual kill** — the founder closes or comments-stop on the Linear run issue.

On completion:

- **Final HTML artifact** → `$TMPDIR/architecture-loop-<run-id>.html` (never the repo), built from
  [`references/HTML-REPORT.md`](references/HTML-REPORT.md): per **shipped** candidate a **before → after**
  (the realized deepening, Tailwind + Mermaid, with the diff/PR link), closing with an **ELI5 "what we
  gained"** section in plain words (locality / leverage / testability).
- **ELI5 summary mirrored** as a comment on the Linear **run issue** (phone-readable) and pushed to Slack.
- **End oracle:** run **`/risoluto-review-handoff`** with the reviewer model pinned to **Codex
  `gpt-5.4 high`** (local auth). It assembles the packet (integration diff + each candidate contract +
  Linear issues) and writes `REVIEW.md` + a Linear comment + Slack.
  - **No-PRD bypass.** `/risoluto-review-handoff` hard-refuses on a missing `docs/prds/<slug>.md` and wants a
    `WAVES.md` + `from:prd-<slug>` issues — none of which this loop produces. So run its review pipeline
    directly: diff = `git diff origin/master...integration/architecture-loop`; in place of the PRD + wave map
    feed each **candidate sub-issue body** (the self-authored contracts) and the run issue's child-issue list
    with states; in place of `from:prd-<slug>` issues query the run issue's children by `parentId`; gate
    evidence = the per-candidate referee verdicts on the sub-issues. Write `REVIEW.md` per
    [`../risoluto-review-handoff/references/review-handoff.v1.md`](../risoluto-review-handoff/references/review-handoff.v1.md).
- **Hand-off, no auto-PR:** **PRINT (never run)** `gh pr create` for
  `integration/architecture-loop → master`. The founder reviews one consolidated PR.
- **After the founder merges:** reconcile the candidate sub-issues to Done (out of band). `/risoluto-sync`
  keys on a `from:prd-<slug>` label these sub-issues don't carry, so it can't be called by slug — instead
  apply its proof-only reconcile manually: query the run issue's children by `parentId`, and for each whose
  `arch/<hash>-*` branch is merged into `integration/architecture-loop` (`git branch --all --merged`), flip it
  to Done and tick only the acceptance criteria you can cite (`/risoluto-sync` Step 3); report the rest as drift.

## Slack notifications — all five (SPEC §6)

Push to Slack (Slack MCP under Claude) on each event; Slack = push, Linear = durable control, overlay /
Remote Control = live steering:

1. **Run start** — with the run config (completion condition, `K=2`, `fuse=8`, model map).
2. **Candidate merged** — one line + the sub-issue link.
3. **Candidate rejected** — one line + reason.
4. **Blocked / defer** — the safe-defer ping (infra/opencode error, or ADR/authority block).
5. **Done + ELI5** — the closing summary.

## Guardrails (SPEC §8 — inherited from the Codex GOAL)

- **Workflow Run is the core primitive;** CLI is primary, TUI next, HTTP API support/internal; **no** web
  frontend / dashboard / docs-site.
- **Respect ADRs.** A candidate that contradicts an ADR or needs a product decision is **deferred/blocked**
  in Linear, never forced through.
- **No product-behavior change** unless the candidate explicitly proves a code-truth alignment or bugfix
  and validates it through public behavior.
- **No unrelated cleanup,** style churn, dependency bumps, broad rewrites, or speculative architecture.
- **Subagent / model-review findings are evidence, not authority** — verify every finding against the
  actual diff and source before acting.
- **Never** add to `quarantine.json` silently — quarantine is only for pre-existing flaky tests with an open
  ticket; a candidate that fails the gate is `rejected`, not silenced into a pass. **Never** `--no-verify` /
  skip hooks. **Never** force-push or rewrite history. **Never** auto-open a PR — print `gh pr create` and stop.
- **No repo-local runtime scratch markdown** (PLAN/ATTEMPTS/NOTES/CONTROL/DISCOVERY). Run-level memory
  lives inside the Linear run issue.

## Setup prerequisites (wiring, checked by Phase 0)

1. Add `deepseek-v4-pro` to opencode as an OpenAI-compatible provider (if not present).
2. Confirm Codex local auth is live for the oracle (`gpt-5.4 high`).
3. The `Risoluto Architecture Loop` Linear project exists, or the first run creates it idempotently.

## Companion files

- [`GOAL.md`](./GOAL.md) — the native `/goal` completion-condition contract this skill runs under
  (`done_when` / `scorecard` are what the evaluator keys on each turn).
- [`references/LANGUAGE.md`](references/LANGUAGE.md), [`references/DEEPENING.md`](references/DEEPENING.md),
  [`references/INTERFACE-DESIGN.md`](references/INTERFACE-DESIGN.md),
  [`references/HTML-REPORT.md`](references/HTML-REPORT.md) — the **vendored** deepening rubric (copied from
  `improve-codebase-architecture` so this skill is self-contained; the interactive command is never run).
- `~/.risoluto/goals/risoluto-architecture-loop/SPEC.md` — the locked human-readable design (source of
  truth for §2–§8).
- [`../references/coder-discipline/`](../references/coder-discipline/) — the per-candidate red-green-refactor build method (the shared discipline files; `risoluto-tdd` is the Linear-aware wrapper around them).
- [`../risoluto-verify-acceptance/`](../risoluto-verify-acceptance/) — the cross-model per-fix referee
  (pin `deepseek-v4-pro`).
- [`../risoluto-review-handoff/`](../risoluto-review-handoff/) — the end-of-run oracle (pin Codex
  `gpt-5.4 high`).
- [`../risoluto-sync/`](../risoluto-sync/) — post-merge Linear reconciliation, after the founder merges
  `integration/architecture-loop → master`.
