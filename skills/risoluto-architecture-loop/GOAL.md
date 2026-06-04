<!--
GOAL.md — the native Claude Code /goal completion-condition contract for the
risoluto-architecture-loop. goal-forge XML block structure, adapted for native
/goal (completion condition + evaluator), NOT Codex runtime config.

This is what the risoluto-architecture-loop skill runs under. The `done_when` /
`scorecard` blocks are what the /goal evaluator keys on each turn. Full design in SPEC.md.
-->

<goal>
Autonomously deepen the architecture of the Risoluto codebase in
`/home/oruc/Desktop/workspace/risoluto`, one candidate at a time. Repeatedly
discover architecture-deepening candidates (shallow→deep modules: better
locality/leverage, more testable, more AI-navigable), self-select one safe
high-confidence `Strong` candidate without asking the founder, self-author its
deepening contract into a Linear sub-issue, implement exactly one candidate per
isolated worktree with `/risoluto-tdd`, verify, review (cheap per-fix referee +
final oracle), merge completed work into `integration/architecture-loop` (never
`master`), and repeat until discovery is exhausted. End by printing — never
running — `gh pr create` for `integration/architecture-loop → master`.
</goal>

<context>
Start in `/home/oruc/Desktop/workspace/risoluto` on branch `master`. Read first:
`AGENTS.md`, `docs/product-spine.md`, `docs/technical-spine.md`,
`docs/decisions.md`, relevant `docs/adr/*.md` for any touched area, and any local
`AGENTS.md` under touched subdirectories.

Discipline source (read, do not invoke the interactive command): the
`improve-codebase-architecture` companion files — `LANGUAGE.md`
(depth/seam/deletion-test vocabulary), `DEEPENING.md` (patterns),
`INTERFACE-DESIGN.md` (contract shape), `HTML-REPORT.md` (report scaffold).

Durable memory & control = Linear (team `RIS`, project `Risoluto Architecture
Loop`, created idempotently). Fast scratch = `/tmp/risoluto-architecture-loop/<run-id>/`.
`research/` submodule is a hard prerequisite.

Canonical gate:
`pnpm run build && pnpm run lint && pnpm run format:check && pnpm test && pnpm run typecheck && pnpm run typecheck:coverage`

Discovery commands when needed: `git submodule status research`, `git status --short`,
`git branch --show-current`, `git remote -v`, `git worktree list`, `rg --files`.
</context>

<constraints>
- Do NOT ask the founder for interactive approval during execution. Use Linear for
  passive control and durable status. If authority is missing, block/defer in Linear.
- Only `Strong`-rated candidates are auto-built. `Worth exploring` / `Speculative`
  are logged to the ledger and never built unattended.
- One candidate per isolated worktree, branched off the `integration/architecture-loop`
  tip. Sequential — never parallel.
- Never touch `master`. Merge only into `integration/architecture-loop`. Never auto-open
  a PR — print `gh pr create` and stop.
- Workflow Run is the core primitive; CLI primary; no web frontend / dashboard / docs-site.
- Respect ADRs. A candidate that contradicts an ADR or needs a product decision is
  deferred/blocked in Linear, not forced through.
- No product-behavior change unless the candidate proves a code-truth alignment or bugfix
  and validates it through public behavior. No unrelated cleanup, style churn, dependency
  bumps, broad rewrites, or speculative architecture.
- Subagent / model-review findings are evidence, not authority — verify against the actual
  diff and source before acting.
- Never `--no-verify`, never add to `quarantine.json` silently, never force-push / rewrite history.
- No repo-local runtime scratch markdown (PLAN/ATTEMPTS/NOTES/CONTROL/DISCOVERY). Run-level memory
  lives inside the Linear run issue.
</constraints>

<scorecard>
Primary signal: the machine-readable candidate ledger
(`/tmp/risoluto-architecture-loop/<run-id>/ledger.json`, rebuilt from Linear at run start),
one row per candidate `{ id: hash(files+problem), strength, status }`.

- Progress metric: count of candidate sub-issues in `merged` state.
- Stop signal: number of rows with `status=open AND strength=Strong` in a fresh discovery pass.
- Regression check: every merge is preceded by a green full gate + clean `/code-review` +
  per-fix referee `met`. A candidate that cannot pass is `rejected`/`blocked`, never merged.
- Hard fuse: stop unconditionally after 8 merged candidates.
  </scorecard>

<done_when>
The run is COMPLETE when ANY of:

1. Two (`K=2`) CONSECUTIVE fresh discovery passes each surface ZERO candidates with
   `status=open AND strength=Strong` (discovery-exhaustion). — primary
2. 8 candidates have reached `merged` state (hard fuse).
3. The founder closes/comments-stop on the Linear run issue (manual kill).

On completion: the before/after + ELI5 HTML artifact is written to `$TMPDIR`, the ELI5
summary is mirrored to the Linear run issue and Slack, `/risoluto-review-handoff` (oracle)
has run on `integration/architecture-loop`, and the `gh pr create` command for
`integration/architecture-loop → master` has been PRINTED (not run).
</done_when>

<feedback_loop>

- Fast (inner loop, every TDD step): focused test / typecheck on the touched module.
- Slow (pre-merge, every candidate): full canonical gate via `/v1-check`, then
  `/code-review high` (`xhigh` for high-risk), then `/risoluto-verify-acceptance` with the
  referee model pinned to `deepseek-v4-pro` via opencode (adversarial; default `not-met` /
  escalate when unsure). opencode/infra failure ⇒ safe-defer (`blocked`), never merge unverified.
- Final (once per run): `/risoluto-review-handoff` with reviewer model pinned to Codex
  `gpt-5.4 high` (local auth).
  </feedback_loop>

<workflow>
Per candidate, sequentially:
1. Discover (Explore + rubric files; never the interactive command; never halt). Classify
   Strong/Worth-exploring/Speculative. Upsert sub-issues + ledger. Skip any `hash` already
   merged/rejected in any run.
2. Select highest-strength, oldest `open` Strong candidate. None ⇒ increment dry-counter, re-discover.
3. Self-author the deepening contract (interface/invariants/seam/error-modes/test-surface +
   acceptance criteria) into the candidate sub-issue body.
4. Worktree + branch off the `integration/architecture-loop` tip; `/risoluto-tdd` builds against the contract.
5. Gate in order: `/v1-check` → `/code-review high` → `/risoluto-verify-acceptance`.
6. Pass ⇒ merge worktree into `integration/architecture-loop`, mark sub-issue `merged`, discard worktree.
   Fail ⇒ discard worktree, mark `rejected` (+ ADR if load-bearing) or `blocked` (infra).
7. Re-discover; update consecutive-dry counter; check `done_when`.
</workflow>

<working_memory>
Linear is durable memory. Project `Risoluto Architecture Loop` (team RIS, idempotent).
One run issue per launch holds run config + narrative log (as comments). Candidate
sub-issues (state open/merged/rejected/blocked, `hash(files+problem)` label, PR link,
review verdict, contract in body). `/tmp/.../ledger.json` is the fast projection rebuilt
from Linear at start. No repo-local scratch markdown.
</working_memory>

<human_control_surface>

- Linear run issue: comment or close to pause/stop (passive control + audit).
- `/goal` overlay: live elapsed/turns/tokens.
- Remote Control: monitor/steer from phone, on from day one.
- Slack push (all five): run start · candidate merged · candidate rejected · blocked/defer · done+ELI5.
  </human_control_surface>

<verification_loop>
Per candidate before merge: full canonical gate green, `/code-review` clean, per-fix referee
`met`. Per run before completion: oracle review-handoff produced. Every claim of "done" /
"passing" is backed by command output or a model verdict, never asserted.
</verification_loop>

<execution_rules>

- Phase 0 preflight (GO/NO-GO): repo clean; no tracked repo-local scratch; `research/`
  initialized; branch=`master`; `integration/architecture-loop` exists/created off `master`;
  Linear auth live; `deepseek-v4-pro` reachable via opencode; Codex local auth live; secrets present.
  Block before any Linear write or code edit if a precondition fails.
- Reuse existing skills as operating procedures: `/risoluto-tdd` (build), `/v1-check` (gate),
  `/code-review` (same-model review), `/risoluto-verify-acceptance` (cheap cross-provider referee),
  `/risoluto-review-handoff` (oracle), `/risoluto-sync` (post-merge reconciliation, after the
  founder merges integration→master).
- Models: builder `claude-opus-4-8`; discovery subagents `claude-sonnet-4-6`; referee
  `deepseek-v4-pro` (opencode); oracle Codex `gpt-5.4 high`.
- The interactive `improve-codebase-architecture` command is NOT invoked; only its rubric files are read.
  </execution_rules>

<output_contract>

- Merged architecture deepenings on `integration/architecture-loop` (each its own gated, reviewed commit/branch).
- Linear: run issue + candidate sub-issues with final states; ELI5 summary mirrored to the run issue.
- `$TMPDIR/architecture-loop-<run-id>.html`: per-shipped-candidate before/after + ELI5 "what we gained".
- `REVIEW.md` + Linear comment from the oracle pass.
- A PRINTED (not executed) `gh pr create` command for `integration/architecture-loop → master`.
- Completion signal: `done_when` satisfied and the above artifacts exist.
  </output_contract>
